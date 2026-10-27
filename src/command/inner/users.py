"""Shared Telegram/Web account-state operation; manager identity remains deployment-owned."""
from ... import db, env
from . import utils


async def set_user_state(user, state, current_manager=None):
    if type(state) is not int or state not in (-1, 0, 1, 100):
        raise ValueError('用户角色无效。')
    if user.id in env.MANAGER or user.id == current_manager:
        raise ValueError('不能修改 MANAGER 或当前管理者的角色。')
    if user.id < 0 and state == 100:
        raise ValueError('频道和群组不能设为用户管理员。')
    user.state = state
    await user.save(update_fields=['state'])
    if state == -1 and await db.Sub.filter(user_id=user.id, state=1).exists():
        # Stop future scheduling; already in-flight Telegram sends cannot be recalled.
        await utils.activate_or_deactivate_all_subs(user.id, activate=False)
    return user
