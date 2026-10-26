"""Run the optional offline resource probe in a strictly limited Docker container."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys


def capture(*command):
    return subprocess.check_output(command, text=True, timeout=30).strip()


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def run_mode(root, image, output, mode, rounds):
    name = f'rsstt-ci-probe-{os.getpid()}-{mode}'
    script = root / 'scripts/stress_resources.py'
    if not script.is_file() or script.is_symlink():
        raise ValueError('Expected a checked-in regular stress_resources.py file')
    command = ['docker', 'run', '--name', name, '--network', 'none', '--read-only',
               '--no-healthcheck', '--cpus', '1', '--memory', '512m', '--memory-swap', '512m',
               '--pids-limit', '128', '--ulimit', 'nofile=1024:1024', '--cap-drop', 'ALL',
               '--security-opt', 'no-new-privileges', '--tmpfs', '/tmp:rw,noexec,nosuid,size=128m',
               '--mount', f'type=bind,src={script},dst=/app/scripts/stress_resources.py,readonly',
               '--entrypoint', '/opt/venv/bin/python', image, '/app/scripts/stress_resources.py',
               '--sources', '100', '--targets', '10', '--hosts', '8', '--rounds', str(rounds),
               '--latency-ms', '10', '--require-cgroup-limits']
    if mode == 'churn':
        command.append('--churn')
    metadata = {'mode': mode, 'requested_rounds': rounds, 'timeout_seconds': 600, 'timed_out': False}
    try:
        with (output / f'{mode}.jsonl').open('wb') as stdout, (output / f'{mode}.stderr.log').open('wb') as stderr:
            try:
                result = subprocess.run(command, stdout=stdout, stderr=stderr, timeout=600)
                metadata['docker_exit_code'] = result.returncode
            except subprocess.TimeoutExpired:
                metadata['timed_out'] = True
                subprocess.run(['docker', 'kill', name], capture_output=True, timeout=30)
        container = json.loads(capture('docker', 'inspect', name))[0]
        settings = container['HostConfig']
        metadata.update(state=container['State'], image_id=container['Image'],
                        container_limits={key: settings.get(key) for key in
                                          ('Memory', 'MemorySwap', 'NanoCpus', 'PidsLimit',
                                           'Ulimits', 'ReadonlyRootfs', 'NetworkMode', 'Tmpfs')})
        write_json(output / f'{mode}.metadata.json', metadata)
        if metadata['timed_out'] or metadata.get('docker_exit_code') != 0 or container['State']['OOMKilled']:
            raise RuntimeError(f'{mode}: failed, timed out, or OOM; see metadata and JSONL artifacts')
        records = [json.loads(line) for line in (output / f'{mode}.jsonl').read_text().splitlines() if line.strip()]
        environment = next(row for row in records if row['kind'] == 'environment')
        completed = next(row for row in records if row['kind'] == 'complete')
        samples = [row for row in records if row['kind'] == 'round']
        limits = environment['limits']
        quota, period = map(int, limits['cpu.max'].split())
        if (int(limits['memory.max']) != 512 * 1024**2 or limits['memory.swap.max'] != '0'
                or quota != period or int(limits['pids.max']) != 128):
            raise RuntimeError(f'{mode}: actual cgroup limits do not match the declared CI budget')
        if not completed['invariants_passed'] or len(samples) != rounds or completed['rounds'] != rounds:
            raise RuntimeError(f'{mode}: missing completion/integrity evidence')
        events = {key: int(value) for key, value in
                  (line.split() for line in completed['memory_events'].splitlines())}
        if events.get('oom', 0) or events.get('oom_kill', 0):
            raise RuntimeError(f'{mode}: cgroup recorded an OOM event')
        steady = samples[5:]
        rss = [row['resources']['rss_bytes'] for row in steady]
        fds = [row['resources']['fds'] for row in steady]
        idle = [row['idle_tasks'] for row in steady]
        if any(value is None for value in (*rss, *fds)):
            raise RuntimeError(f'{mode}: Linux current RSS or FD evidence is missing')
        midpoint = (len(rss) - 1) / 2
        rss_mean = sum(rss) / len(rss)
        slope = sum((index - midpoint) * (value - rss_mean) for index, value in enumerate(rss)) / sum(
            (index - midpoint)**2 for index in range(len(rss)))
        summary = {'mode': mode, 'rounds': rounds, 'invariants_passed': True, 'cgroup': limits,
                   'memory_events': events, 'post_warmup_rss_growth_bytes': rss[-1] - rss[0],
                   'post_warmup_rss_slope_bytes_per_round': round(slope, 2),
                   'post_warmup_fd_min_max': [min(fds), max(fds)],
                   'post_warmup_idle_tasks_min_max': [min(idle), max(idle)],
                   'final_caches': samples[-1]['caches'],
                   'limitation': 'Finite synthetic budget test; does not establish a production memory bound'}
        write_json(output / f'{mode}.summary.json', summary)
        print(json.dumps(summary), flush=True)
        return True
    except Exception as error:
        metadata['error'] = str(error)
        write_json(output / f'{mode}.metadata.json', metadata)
        print(str(error), file=sys.stderr, flush=True)
        return False
    finally:
        subprocess.run(['docker', 'rm', '-f', name], capture_output=True, timeout=30)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', default='rsstt-web:ci')
    parser.add_argument('--output', type=Path, default=Path('.ci-artifacts/resource'))
    parser.add_argument('--stable-rounds', type=int, choices=(60, 300), default=60)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    image = json.loads(capture('docker', 'image', 'inspect', args.image))[0]
    write_json(output / 'environment.json', {
        'checkout_sha': capture('git', '-C', str(root), 'rev-parse', 'HEAD'),
        'github_sha': os.environ.get('GITHUB_SHA'), 'image_id': image['Id'],
        'architecture': image['Architecture'], 'os': image['Os'],
        'docker_server': capture('docker', 'version', '--format', '{{.Server.Version}}'),
        'cgroup_version': capture('docker', 'info', '--format', '{{.CgroupVersion}}'),
        'budget': {'cpus': 1, 'memory_bytes': 512 * 1024**2, 'swap_bytes': 0,
                   'pids': 128, 'fds': 1024, 'tmpfs_bytes': 128 * 1024**2},
        'transport': 'Offline synthetic RSS and Telegram; no healthcheck or external connections'})
    stable = run_mode(root, args.image, output, 'stable', args.stable_rounds)
    churn = run_mode(root, args.image, output, 'churn', 60)
    return 0 if stable and churn else 1


if __name__ == '__main__':
    raise SystemExit(main())
