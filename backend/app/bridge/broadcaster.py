import asyncio
import json


class Broadcaster:
    """Fan-out hub for Server-Sent Events: every subscriber gets its own queue
    and publish copies each message to all of them.

    Note(yoochan.kim): kept event-name agnostic so future async task runners can
    push their own progress through the same dashboard stream.
    """

    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[str]] = set()

    def publish(self, event: str, data: dict) -> None:
        message = f"event: {event}\ndata: {json.dumps(data)}\n\n"
        for queue in self._subscribers:
            queue.put_nowait(message)

    def register(self) -> asyncio.Queue[str]:
        queue: asyncio.Queue[str] = asyncio.Queue()
        self._subscribers.add(queue)
        return queue

    def unregister(self, queue: asyncio.Queue[str]) -> None:
        self._subscribers.discard(queue)
