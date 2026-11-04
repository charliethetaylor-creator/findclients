"""FindClients is a research tool. There is no sending mode in this fork."""

MESSAGE = "FindClients is research-only. Copy a draft and contact the prospect yourself."


class OutreachDisabled(RuntimeError):
    pass


def reject_outreach():
    """Guard the actual integration boundary, including old queued work."""
    raise OutreachDisabled(MESSAGE)
