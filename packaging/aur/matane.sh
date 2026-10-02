#!/bin/sh
# Tells Matane it came from the AUR: it then says "update through your package manager" instead
# of offering a download (ADR 0021).
export MATANE_PACKAGE=aur
exec /opt/matane/matane "$@"
