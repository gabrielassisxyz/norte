// Package webassets carries the built frontend inside the binary.
//
// Go's embed cannot reach outside the package directory, so bin/generate copies
// web/dist into dist/ here before the build. Only dist/placeholder.html is
// committed, which is what keeps this package compiling in a fresh clone.
package webassets

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var embedded embed.FS

// FS returns the built frontend rooted at the directory the files were copied
// into, so a handler sees "index.html" rather than "dist/index.html".
func FS() fs.FS {
	sub, err := fs.Sub(embedded, "dist")
	if err != nil {
		// Unreachable: the directory is embedded above, so fs.Sub can only fail
		// on an invalid path.
		panic(err)
	}
	return sub
}
