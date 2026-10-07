// Command norte serves Norte's frontend and API from a single binary.
package main

import (
	"context"
	"os"

	"github.com/gabrielassisxyz/norte/server/internal/app"
)

func main() {
	os.Exit(app.Execute(context.Background()))
}
