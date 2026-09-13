# Registry origin

`serve_registry.py` is an implemented dependency-free loopback HTTP origin for a
catalog and immutable signed ZIPs. It rejects symlinks, directory listing and paths
outside the configured registry. Tests are in `test_*.py`.

Run behind operator-controlled HTTPS; it is not an authenticated internet-facing
module marketplace. Serve only intended registry artifacts, never the source tree
or signing directory. Adapt `nginx-registry.conf.example` to your own hostname, TLS and access policy.

See [reproduction status](../docs/reproduce.md) and [security boundaries](../SECURITY.md).
