// Command norte serves Norte's frontend and API from a single binary.
package main

import (
	"context"
	"os"

	"github.com/gabrielassisxyz/norte/server/internal/app"
	// The module packages register themselves with the app's registry from
	// init; main pulls them into the binary with these blank imports, which
	// is what makes them compiled in and switchable through NORTE_MODULES.
	_ "github.com/gabrielassisxyz/norte/server/internal/library"
)

func main() {
	os.Exit(app.Execute(context.Background()))
}
