package core

import "github.com/google/uuid"

// IDLength is how many characters an id from NewID has: a hyphenated UUID in
// its canonical form.
const IDLength = 36

// NewID returns the identifier every Norte table uses as its primary key: a
// UUIDv7 rendered as a 36-character lowercase string.
//
// Version 7 carries a millisecond timestamp in its leading bits, so later ids
// sort after earlier ones as bytes and as text alike. That keeps primary-key
// inserts append-only at the right edge of SQLite's B-tree instead of
// scattering them through it, and it is why no table here uses an integer id:
// an integer id is local to one table, and a link between two modules needs an
// id that means the same thing everywhere.
func NewID() string {
	// NewV7 fails only when the system's random source does, which is not a
	// condition this program can carry on through.
	return uuid.Must(uuid.NewV7()).String()
}
