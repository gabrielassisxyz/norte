package webassets_test

import (
	"io/fs"
	"testing"

	"github.com/gabrielassisxyz/norte/server/internal/webassets"
)

// The committed placeholder is what keeps this package compiling before the
// first bin/generate run, so its absence has to be a test failure rather than a
// build failure in a fresh clone.
func TestEmbeddedAssetsCarryThePlaceholder(t *testing.T) {
	if _, err := fs.Stat(webassets.FS(), "placeholder.html"); err != nil {
		t.Fatalf("dist/placeholder.html is not embedded: %v", err)
	}
}
