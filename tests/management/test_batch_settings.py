"""Batch settings: whatever one subscription can be given, a selection can be given as well."""
import re
from pathlib import Path

import pytest

from src import db
from src.command.inner.customization import SUB_OPTIONS_EXHAUSTIVE_VALUES
from src.management import batch_settings, feed_options
from src.management.service import SUB_PATCH_KEYS

from conftest import ORIGIN, token

HEADERS = {'Origin': ORIGIN}
BATCH = '/api/subscriptions/batch'
PROXY = 'http://user:secret@proxy.example:8080'

# One or more representative values for every setting a single subscription accepts. The options take
# every legal value from the bot's own table, so a new option is covered without touching this file;
# any other new setting must get its samples here, otherwise test_every_single_setting_has_a_sample fails.
SAMPLES = {
    'title': ['Renamed', None],
    'tags': ['#alpha #beta', None],
    'interval': [90, None],
    'length_limit': [0, 300, 4096, -100],
    'state': [0, 1],
}
SAMPLES.update({key: [*values, -100] for key, values in SUB_OPTIONS_EXHAUSTIVE_VALUES.items()})


@pytest.fixture(autouse=True)
def forget_proxies():
    """Proxies live in memory, shared by the whole test run."""
    yield
    feed_options._proxies.clear()


def shown(data):
    return {key: data[key] for key in ('custom_title', 'tags', 'state', 'options')}


async def batch(client, ids, changes, headers=HEADERS):
    return await client.post(BATCH, json={'ids': ids, 'action': 'settings', 'changes': changes}, headers=headers)


async def second_feed(user_id=-1001):
    feed = await db.Feed.create(link='https://second.example/rss', title='Second')
    return feed, await db.Sub.create(user_id=user_id, feed=feed)


async def single_and_batch_agree(logged, key, value):
    """The same value, once through PATCH and once through the batch, on two identical subscriptions."""
    client = logged.client
    one = await client.patch(f'/api/subscriptions/{logged.sub.id}', json={key: value}, headers=HEADERS)
    assert one.status == 200, (key, value, await one.text())
    done = await batch(client, [logged.other.id], {key: value})
    assert done.status == 200, (key, value, await done.text())
    assert (await done.json())['results'] == [{'id': logged.other.id, 'ok': True, 'applied': ['subscription']}]
    a = await (await client.get(f'/api/subscriptions/{logged.sub.id}')).json()
    b = await (await client.get(f'/api/subscriptions/{logged.other.id}')).json()
    assert shown(a) == shown(b), (key, value)


def test_every_single_setting_has_a_sample():
    assert set(SAMPLES) == set(SUB_PATCH_KEYS), 'give every new single-subscription setting samples here'


async def test_batch_accepts_exactly_what_a_single_subscription_accepts(logged):
    """Fails when a setting is added to (or dropped from) one side only."""
    auth = await token(logged, 'write', ['-1001'])
    spec = await (await logged.client.get('/api/openapi.json', headers=auth)).json()
    single = spec['paths']['/api/subscriptions/{id}']['patch']['requestBody']['content']['application/json']['schema']
    bulk = spec['paths']['/api/subscriptions/batch']['post']['requestBody']['content']['application/json']['schema']
    changes = bulk['properties']['changes']['properties']
    assert set(single['properties']) == set(SUB_PATCH_KEYS)
    assert set(single['properties']) <= set(changes)
    assert set(changes) - set(single['properties']) == {*batch_settings.FEED_KEYS, *batch_settings.RECIPIENT_KEYS}
    assert set(changes) == set(batch_settings.SETTINGS_KEYS)
    assert 'settings' in bulk['properties']['action']['enum']
    for key in single['properties']:
        assert changes[key] == single['properties'][key], f'{key} differs between PATCH and batch'


@pytest.mark.parametrize('key', sorted(SAMPLES))
async def test_each_single_setting_batches_to_the_same_result(logged, key):
    for value in SAMPLES[key]:
        await single_and_batch_agree(logged, key, value)


async def test_a_value_the_single_setting_refuses_is_refused_by_the_batch(logged):
    bad = {'display_media': 5, 'notify': 2, 'style': -1, 'length_limit': 5000, 'interval': 0, 'tags': 'x' * 300,
           'title': 'x' * 2000, 'state': 2, 'send_mode': 'auto', 'display_via': 3}
    for key, value in bad.items():
        assert (await logged.client.patch(f'/api/subscriptions/{logged.sub.id}', json={key: value}, headers=HEADERS)).status == 400, key
        refused = await batch(logged.client, [logged.sub.id, logged.other.id], {key: value})
        assert refused.status == 400, key
    for sub in (logged.sub, logged.other):
        await sub.refresh_from_db()
        assert sub.display_media == 0 and sub.title is None and sub.interval is None


async def test_only_the_settings_that_were_sent_change(logged):
    await db.Sub.filter(id=logged.sub.id).update(title='Mine', tags='keep', interval=45, display_media=0, display_author=-1, length_limit=200)
    await db.Sub.filter(id=logged.other.id).update(title='Other', interval=30, display_title=1, notify=0)
    done = await batch(logged.client, [logged.sub.id, logged.other.id], {'display_media': -1})
    assert all(item['ok'] for item in (await done.json())['results'])
    first, second = await db.Sub.get(id=logged.sub.id), await db.Sub.get(id=logged.other.id)
    assert (first.display_media, second.display_media) == (-1, -1)
    assert (first.title, first.tags, first.interval, first.display_author, first.length_limit) == ('Mine', 'keep', 45, -1, 200)
    assert (second.title, second.interval, second.display_title, second.notify) == ('Other', 30, 1, 0)
    assert second.tags is None


async def test_every_setting_at_once(logged):
    changes = {'title': 'All', 'tags': '#a, #b', 'interval': 120, 'length_limit': 0, 'state': 0,
               **{key: SAMPLES[key][0] for key in SUB_OPTIONS_EXHAUSTIVE_VALUES}}
    assert set(changes) == set(SUB_PATCH_KEYS)
    done = await batch(logged.client, [logged.sub.id, logged.other.id], changes)
    assert [item['ok'] for item in (await done.json())['results']] == [True, True]
    for sub in (logged.sub, logged.other):
        await sub.refresh_from_db()
        assert (sub.title, sub.tags, sub.interval, sub.state, sub.length_limit) == ('All', 'a b', 120, 0, 0)
        assert all(getattr(sub, key) == values[0] for key, values in SUB_OPTIONS_EXHAUSTIVE_VALUES.items())


async def test_failures_are_reported_one_by_one_and_the_rest_is_saved(logged):
    await db.User.filter(id=-1002).update(state=-1)
    done = await batch(logged.client, [logged.sub.id, logged.other.id], {'state': 1, 'display_media': -1})
    first, second = (await done.json())['results']
    assert first == {'id': logged.sub.id, 'ok': True, 'applied': ['subscription']}
    assert second['ok'] is False and second['code'] == 'TARGET_BANNED' and second['status'] == 409 and second['applied'] == []
    assert (await db.Sub.get(id=logged.sub.id)).display_media == -1
    assert (await db.Sub.get(id=logged.other.id)).display_media == 0


async def test_the_whole_selection_is_authorized_before_anything_is_saved(logged):
    auth = await token(logged, 'write', ['-1001'])
    refused = await batch(logged.client, [logged.sub.id, logged.other.id], {'display_media': -1}, headers=auth)
    assert refused.status == 404
    assert (await db.Sub.get(id=logged.sub.id)).display_media == 0
    allowed = await batch(logged.client, [logged.sub.id], {'display_media': -1}, headers=auth)
    assert allowed.status == 200 and (await db.Sub.get(id=logged.sub.id)).display_media == -1


async def test_requests_that_change_nothing_or_are_malformed_are_refused(logged):
    ids = [logged.sub.id]
    for changes in ({}, None, [], {'bogus': 1}, {'sub_limit': 5}, {'lang': 'en'}, {'add_recipients': 'x'},
                    {'add_recipients': ['abc']}, {'add_recipients': ['1'], 'remove_recipients': ['1']}):
        assert (await batch(logged.client, ids, changes)).status == 400, changes
    missing = await logged.client.post(BATCH, json={'ids': ids, 'action': 'settings'}, headers=HEADERS)
    assert missing.status == 400
    # The other actions keep their own rules: `changes` is ignored by them.
    paused = await logged.client.post(BATCH, json={'ids': ids, 'action': 'pause'}, headers=HEADERS)
    assert (await paused.json())['results'] == [{'id': ids[0], 'ok': True}]


async def test_feed_settings_are_for_administrators_and_apply_once_per_feed(logged):
    other_feed, extra = await second_feed()
    ids = [logged.sub.id, logged.other.id, extra.id]
    auth = await token(logged, 'write', ['-1001', '-1002'])
    for changes in ({'proxy': 'direct'}, {'user_agent': 'Bot/1'}):
        assert (await batch(logged.client, ids, changes, headers=auth)).status == 403
    assert feed_options.proxy_for(logged.feed.link) is None
    done = await batch(logged.client, ids, {'proxy': PROXY, 'user_agent': ' My Reader/1.0 ', 'display_media': -1})
    assert (await done.json())['results'] == [{'id': ident, 'ok': True, 'applied': ['subscription', 'fetch_options']} for ident in ids]
    for feed in (logged.feed, other_feed):
        assert feed_options.proxy_for(feed.link) == PROXY
        rows = await logged.store.rows('SELECT user_agent FROM feed_fetch_options WHERE url=?', (feed.link,))
        assert rows[0]['user_agent'] == 'My Reader/1.0'
    detail = await (await logged.client.get(f'/api/feeds/{logged.feed.id}/fetch-options')).json()
    assert detail['user_agent'] == 'My Reader/1.0' and PROXY not in str(detail)
    # the credentials stay out of the audit log
    assert 'secret' not in str(await logged.store.rows('SELECT * FROM activity'))
    cleared = await batch(logged.client, ids, {'proxy': None, 'user_agent': None})
    assert cleared.status == 200
    assert feed_options.proxy_for(logged.feed.link) is None and feed_options.proxy_for(other_feed.link) is None
    assert not await logged.store.rows('SELECT * FROM feed_fetch_options')
    for changes in ({'proxy': 'ftp://nope'}, {'user_agent': 'bad\nagent'}, {'user_agent': 'x' * 513}):
        assert (await batch(logged.client, ids, changes)).status == 400


async def test_recipients_can_be_added_to_and_removed_from_every_selected_feed(logged):
    other_feed, extra = await second_feed()
    ids = [logged.sub.id, extra.id]
    done = await batch(logged.client, ids, {'add_recipients': ['1', '2'], 'display_media': -1})
    assert (await done.json())['results'] == [{'id': ident, 'ok': True, 'applied': ['subscription', 'recipients']} for ident in ids]
    for feed in (logged.feed, other_feed):
        assert set(await db.Sub.filter(feed_id=feed.id).values_list('user_id', flat=True)) >= {1, 2, -1001}
    assert (await db.Sub.get(user_id=1, feed_id=other_feed.id)).display_media == -100  # new recipients start from the chat defaults
    removed = await batch(logged.client, ids, {'remove_recipients': ['1', '-1002']})
    assert all(item['ok'] for item in (await removed.json())['results'])
    assert set(await db.Sub.filter(feed_id=logged.feed.id).values_list('user_id', flat=True)) == {2, -1001}
    assert set(await db.Sub.filter(feed_id=other_feed.id).values_list('user_id', flat=True)) == {2, -1001}


async def test_recipient_failures_name_the_subscriptions_they_belong_to(logged):
    await db.User.filter(id=2).update(state=-1)
    done = await batch(logged.client, [logged.sub.id], {'add_recipients': ['2'], 'tags': '#kept'})
    item = (await done.json())['results'][0]
    assert item['ok'] is False and item['code'] == 'TARGET_BANNED' and item['applied'] == ['subscription']
    assert (await db.Sub.get(id=logged.sub.id)).tags == 'kept'
    assert not await db.Sub.filter(user_id=2).exists()


async def test_selected_subscriptions_that_remove_each_other_still_report(logged):
    """Removing a chat deletes its subscription, which may itself be part of the selection."""
    done = await batch(logged.client, [logged.sub.id, logged.other.id], {'title': 'X', 'remove_recipients': ['-1002']})
    assert [item['ok'] for item in (await done.json())['results']] == [True, True]
    assert await db.Sub.filter(id=logged.sub.id).exists() and not await db.Sub.filter(id=logged.other.id).exists()


async def test_the_audit_log_names_the_settings_but_not_their_values(logged):
    await batch(logged.client, [logged.sub.id], {'proxy': PROXY, 'title': 'Secretive title'})
    rows = str(await logged.store.rows('SELECT * FROM activity'))
    assert 'settings' in rows and 'proxy' in rows
    assert 'secret' not in rows and 'Secretive' not in rows


def test_the_console_offers_every_option_of_the_bot_with_the_bots_values():
    """The drawer and the batch dialog are both built from options.js, so it must match customization.py."""
    text = (Path(__file__).parents[2] / 'src/management/static/options.js').read_text()
    blocks = re.split(r'\n    \{\n        key: "', text.split('export const OPTIONS = [', 1)[1].split('\n];', 1)[0])[1:]
    shown = {block.split('"', 1)[0]: re.findall(r'^\s+\[(-?\d+), ', block, re.M) for block in blocks}
    assert set(shown) == set(SUB_OPTIONS_EXHAUSTIVE_VALUES) | {'length_limit'}
    for key, values in SUB_OPTIONS_EXHAUSTIVE_VALUES.items():
        assert sorted(map(int, shown[key])) == sorted(values), key
