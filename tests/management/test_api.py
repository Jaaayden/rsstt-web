import asyncio
import json

import pytest

from src import db
from src.management.store import Store
from conftest import ORIGIN, PASSWORD, token

WRITE = {'Origin': ORIGIN}


async def test_auth_cookie_and_origin(context):
    c=context.client
    assert (await c.get('/api/dashboard')).status == 401
    assert (await c.post('/api/login',json={'password':PASSWORD})).status == 403
    assert (await c.post('/api/login',json={'password':'wrong'},headers=WRITE)).status == 401
    response=await c.post('/api/login',json={'password':PASSWORD},headers=WRITE)
    cookie=response.cookies['rsstt_session']
    assert cookie['httponly'] and cookie['samesite']=='Strict'
    assert (await c.get('/api/dashboard')).status == 200
    assert (await c.patch('/api/settings',json={'attention_threshold':5})).status == 403
    assert (await c.patch('/api/settings',json={'attention_threshold':5},headers={'Origin':'https://evil.test'})).status == 403
    assert (await c.post('/api/logout',headers=WRITE)).status == 200
    assert (await c.get('/api/dashboard')).status == 401


async def test_brute_force_is_bounded(context):
    for _ in range(10):
        assert (await context.client.post('/api/login',json={'password':'bad'},headers=WRITE)).status==401
    assert (await context.client.post('/api/login',json={'password':PASSWORD},headers=WRITE)).status==429


async def test_scoped_permissions_and_batch_atomic_authorization(context):
    headers=await token(context)
    c=context.client
    data=await (await c.get('/api/subscriptions',headers=headers)).json()
    assert [r['id'] for r in data['items']]==[context.sub.id]
    assert (await c.get('/api/targets/-1002/opml',headers=headers)).status==403
    assert (await c.patch(f'/api/subscriptions/{context.other.id}',json={'state':0},headers=headers)).status==404
    assert (await c.get('/api/dashboard',headers=headers)).status==403
    assert (await c.post('/api/tokens',json={},headers=headers)).status==403
    response=await c.post('/api/subscriptions/batch',json={'ids':[context.sub.id,context.other.id],'action':'pause'},headers=headers)
    assert response.status==404
    assert (await db.Sub.get(id=context.sub.id)).state==1
    read=await token(context,'read')
    assert (await c.get('/api/subscriptions',headers=read)).status==200
    response=await c.delete(f'/api/subscriptions/{context.sub.id}',headers=read)
    assert response.status==403


async def test_scoped_token_revoke_and_expiry(logged):
    c=logged.client
    r=await c.post('/api/tokens',json={'name':'FeedLantern','permission':'write','targets':['-1001'],'days':3},headers=WRITE)
    assert r.status==201
    data=await r.json()
    stored=await logged.store.rows('SELECT * FROM credentials WHERE id=?',(data['id'],))
    assert data['token'] not in json.dumps(stored)
    headers={'Authorization':'Bearer '+data['token']}
    assert (await c.get('/api/subscriptions',headers=headers)).status==200
    response=await c.delete('/api/tokens/'+data['id'],headers=WRITE)
    assert response.status==200
    assert (await c.get('/api/subscriptions',headers=headers)).status==401
    ident,secret=await logged.store.issue('Expired','token','read',['-1001'],days=-1)
    assert (await c.get('/api/subscriptions',headers={'Authorization':'Bearer '+secret})).status==401


async def test_idempotent_add_preserves_customization_and_limits(logged):
    sub=logged.sub
    sub.title='Keep me';sub.state=0;sub.send_mode=2
    await sub.save()
    user=await db.User.get(id=-1001);user.sub_limit=1;await user.save()
    r=await logged.client.post('/api/subscriptions',json={'target':'-1001','urls':[logged.feed.link,'https://new.example/feed']},headers=WRITE)
    assert r.status==200
    data=await r.json()
    assert [r['status'] for r in data['results']]==['existing','failed']
    fresh=await db.Sub.get(id=sub.id)
    assert (fresh.title,fresh.state,fresh.send_mode)==('Keep me',0,2)
    assert await db.Sub.filter(user_id=-1001).count()==1


async def test_add_existing_feed_and_pause_updates_scheduler(logged):
    c=logged.client
    r=await c.post('/api/subscriptions',json={'target':'2','urls':[logged.feed.link]},headers=WRITE)
    assert r.status==200
    data=await r.json(); assert data['results'][0]['status']=='created'
    new_id=data['results'][0]['id']
    assert (await c.patch(f'/api/subscriptions/{new_id}',json={'interval':6},headers=WRITE)).status==200
    assert db.EffectiveTasks.get_interval(logged.feed.id)==6
    assert (await c.patch(f'/api/subscriptions/{new_id}',json={'state':0},headers=WRITE)).status==200
    assert db.EffectiveTasks.get_interval(logged.feed.id)==10
    assert (await c.post('/api/subscriptions/batch',json={'ids':[logged.sub.id,logged.other.id],'action':'pause'},headers=WRITE)).status==200
    assert (await db.Feed.get(id=logged.feed.id)).state==0
    assert db.EffectiveTasks.get_interval(logged.feed.id) is None
    assert (await c.patch(f'/api/subscriptions/{new_id}',json={'state':1},headers=WRITE)).status==200
    assert db.EffectiveTasks.get_interval(logged.feed.id)==6


async def test_delete_only_removes_target_subscription(logged):
    response=await logged.client.delete(f'/api/subscriptions/{logged.sub.id}',headers=WRITE)
    assert response.status==200
    assert await db.Sub.filter(id=logged.other.id).exists()
    assert await db.Feed.filter(id=logged.feed.id).exists()


async def test_options_validation_before_any_write(logged):
    c=logged.client
    assert (await c.patch(f'/api/subscriptions/{logged.sub.id}',json={'title':'Changed','send_mode':999},headers=WRITE)).status==400
    assert (await db.Sub.get(id=logged.sub.id)).title is None
    assert (await c.patch('/api/settings',json={'default_interval':2,'minimal_interval':5},headers=WRITE)).status==400
    assert db.EffectiveOptions.default_interval==10
    assert (await c.patch('/api/settings',json={'default_interval':15},headers=WRITE)).status==200
    assert db.EffectiveTasks.get_interval(logged.feed.id)==15
    assert (await c.patch('/api/targets/-1001',json={'interval':7,'display_title':-1},headers=WRITE)).status==200
    assert db.EffectiveTasks.get_interval(logged.feed.id)==7


async def test_attention_requires_consecutive_threshold_and_recovers(logged):
    c=logged.client
    logged.feed.error_count=2;await logged.feed.save()
    assert (await (await c.get('/api/dashboard')).json())['counts']['attention']==0
    logged.feed.error_count=3;await logged.feed.save()
    assert (await (await c.get('/api/dashboard')).json())['counts']['attention']==2
    assert (await c.patch('/api/settings',json={'attention_threshold':5},headers=WRITE)).status==200
    assert (await (await c.get('/api/dashboard')).json())['counts']['attention']==0
    logged.feed.error_count=7;await logged.feed.save()
    assert (await (await c.get('/api/subscriptions?attention=1')).json())['total']==2
    logged.feed.error_count=0;await logged.feed.save()
    assert (await (await c.get('/api/subscriptions?attention=1')).json())['total']==0


async def test_target_counts_search_and_pagination(logged):
    c=logged.client
    d=await (await c.get('/api/targets?size=2')).json()
    assert d['total']==4 and len(d['items'])==2
    d=await (await c.get('/api/targets?q=Target%20-1001')).json()
    assert len(d['items'])==1 and d['items'][0]['subscriptions']==1
    d=await (await c.get('/api/targets?kind=channel')).json()
    assert d['total']==2
    assert (await c.get('/api/subscriptions?size=10000')).status==400


async def test_opml_export_import_and_xml_entity_rejection(logged):
    c=logged.client
    r=await c.get('/api/targets/-1001/opml')
    opml=await r.text()
    assert 'https://example.com/rss' in opml
    r=await c.post('/api/targets/2/opml',json={'opml':opml},headers=WRITE)
    assert r.status==200 and (await r.json())['results'][0]['status']=='created'
    xml='<!DOCTYPE opml [<!ENTITY x SYSTEM "file:///etc/passwd">]><opml><body>&x;</body></opml>'
    assert (await c.post('/api/targets/2/opml',json={'opml':xml},headers=WRITE)).status==400
    assert (await c.post('/api/targets/2/opml',json={'opml':'<opml>'},headers=WRITE)).status==400


async def test_leave_requires_confirmation_and_only_pauses_after_success(logged):
    c=logged.client
    assert (await c.post('/api/targets/-1001/leave',json={'confirm':'wrong'},headers=WRITE)).status==400
    logged.gateway.denied=True
    assert (await c.post('/api/targets/-1001/leave',json={'confirm':'-1001'},headers=WRITE)).status==502
    assert (await db.Sub.get(id=logged.sub.id)).state==1
    logged.gateway.denied=False
    assert (await c.post('/api/targets/-1001/leave',json={'confirm':'-1001'},headers=WRITE)).status==200
    assert logged.gateway.left==[-1001]
    assert (await db.Sub.get(id=logged.sub.id)).state==0
    assert (await db.Sub.get(id=logged.other.id)).state==1
    assert (await logged.store.target_map([-1001]))['-1001']['membership']=='left'


async def test_metrics_survive_restart_and_history_pruning(tmp_path):
    path=tmp_path/'console.sqlite3';store=await Store(path).open()
    await store.increment(fetched=20,delivered=45,day='2000-01-01')
    await asyncio.gather(*(store.increment(fetched=1,delivered=2) for _ in range(30)))
    await store.close();store=await Store(path).open()
    stats=await store.statistics()
    assert stats['totals']['fetched']==50 and stats['totals']['delivered']==105
    assert len(stats['daily'])==1
    for i in range(210):await store.audit('Test','change',str(i))
    assert len(await store.rows('SELECT * FROM activity'))==200
    assert (await store.statistics())['totals']==stats['totals']
    await store.close()


@pytest.mark.parametrize('url',['file:///etc/passwd','javascript:alert(1)','https://user:pass@example.com/rss','ftp://x.test/rss','https://x.test:abc/rss'])
async def test_invalid_feed_addresses(logged,url):
    r=await logged.client.post('/api/subscriptions',json={'target':'2','urls':[url]},headers=WRITE)
    assert r.status==400


async def test_html_is_served_with_security_headers(logged):
    response=await logged.client.get('/')
    assert response.status==200
    assert "frame-ancestors 'none'" in response.headers['Content-Security-Policy']
    assert 'no-store' in response.headers['Cache-Control']
    assert (await logged.client.get('/assets/server.py')).status==404
