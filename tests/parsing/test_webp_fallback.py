import os
import sys
import tempfile
from io import BytesIO
from types import SimpleNamespace

import pytest
from PIL import Image as PILImage
from telethon.tl.types import InputMediaUploadedPhoto

CONFIG = tempfile.TemporaryDirectory(prefix='rsstt-parsing-tests-')
os.environ.update(TOKEN='test', MANAGER='1', MULTIPROCESSING='0')
_argv = sys.argv
sys.argv = [sys.argv[0], '-c', CONFIG.name]
from src import env, web  # noqa: E402  (importing it reads the settings above)
sys.argv = _argv
from src.parsing import medium
from src.parsing.medium import Animation, Image, LocalConvertedImage, _reencode_as_jpeg

URL = 'https://forum.test/a.png'


def encode(size=(720, 1276), mode='RGB', fmt='WEBP', color=(200, 60, 60)):
    with BytesIO() as out:
        PILImage.new(mode, size, color).save(out, fmt)
        return out.getvalue()


@pytest.fixture
def served(monkeypatch):
    """A server that sends WebP under any name, wsrv.nl refusing it, and a Telegram that takes uploads."""
    state = SimpleNamespace(body=encode(), status=200, content_type='image/webp', uploads=[], fetched=[])

    async def get_medium_info(url):
        # only the original address answers; wsrv.nl and the relay do not
        return (len(state.body), -1, -1, state.content_type) if url == URL else None

    async def get(url, **_):
        state.fetched.append(url)
        return SimpleNamespace(status=state.status, content=state.body)

    async def upload_file(file, file_name=None):
        state.uploads.append((file, file_name))
        return f'uploaded-{len(state.uploads)}'

    async def inline(func, *args, **kwargs):
        kwargs.pop('prefer_pool', None)
        return func(*args, **kwargs)

    monkeypatch.setattr(web, 'get_medium_info', get_medium_info)
    monkeypatch.setattr(web, 'get', get)
    monkeypatch.setattr(medium, 'run_async', inline)
    monkeypatch.setattr(env, 'bot', SimpleNamespace(upload_file=upload_file), raising=False)
    return state


def test_reencode_makes_a_jpeg_photo_from_webp():
    jpeg = _reencode_as_jpeg(encode())
    with PILImage.open(BytesIO(jpeg)) as image:
        assert image.format == 'JPEG' and image.size == (720, 1276)


def test_reencode_flattens_transparency_onto_white():
    with PILImage.open(BytesIO(_reencode_as_jpeg(encode((40, 40), 'RGBA', color=(0, 0, 0, 0))))) as image:
        assert image.convert('RGB').getpixel((20, 20)) == (255, 255, 255)


def test_reencode_shrinks_large_images_and_refuses_shapes_telegram_rejects():
    with PILImage.open(BytesIO(_reencode_as_jpeg(encode((6000, 4000))))) as image:
        assert max(image.size) == medium.LOCAL_CONVERT_MAX_SIDE
    with pytest.raises(ValueError):
        _reencode_as_jpeg(encode((4000, 100)))
    with pytest.raises((OSError, ValueError)):
        _reencode_as_jpeg(b'not an image')


@pytest.mark.parametrize('kind', [Image, Animation])
async def test_webp_wsrv_will_not_convert_is_sent_as_a_photo(served, kind):
    # a .gif address is read as an animation, but serving WebP it is no animation either
    item = kind(URL)
    await item.validate()
    chain = item.type_fallback_chain()
    assert isinstance(chain, LocalConvertedImage)
    assert isinstance(chain.telegramize(), InputMediaUploadedPhoto)
    (file, name), = served.uploads
    assert file[:3] == b'\xff\xd8\xff' and name == 'image.jpg'  # a JPEG, not a WebP file Telegram shows as a sticker
    assert served.fetched == [URL]


async def test_webp_that_cannot_be_fetched_here_keeps_the_old_behaviour(served):
    served.status = 404
    item = Image(URL)
    await item.validate()
    assert not isinstance(item.type_fallback_chain(), LocalConvertedImage)
    assert served.uploads == []

    served.uploads.clear()
    animation = Animation(URL)
    await animation.validate()
    assert animation.type_fallback_chain() is animation  # still sent as it was
    assert animation.valid


async def test_ordinary_images_do_not_go_through_the_local_conversion(served):
    served.content_type = 'image/jpeg'
    served.body = encode(fmt='JPEG')

    async def get_medium_info(url):
        return (len(served.body), 720, 1276, 'image/jpeg') if url == URL else None

    served_get_info = web.get_medium_info
    web.get_medium_info = get_medium_info
    try:
        item = Image(URL)
        await item.validate()
    finally:
        web.get_medium_info = served_get_info
    assert item.valid and item.type_fallback_chain() is item
    assert served.fetched == [] and served.uploads == []
