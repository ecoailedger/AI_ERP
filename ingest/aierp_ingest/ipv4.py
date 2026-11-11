"""Import before any network call.

Some networks have a broken IPv6 route and Python does not fall back, so calls hang silently.
This keeps IPv4 DNS results, falling back to everything if there are none.
"""
import socket

_original = socket.getaddrinfo


def _ipv4_first(*args, **kwargs):
    results = _original(*args, **kwargs)
    return [result for result in results if result[0] == socket.AF_INET] or results


socket.getaddrinfo = _ipv4_first
