package core

import "time"

// Clock is the only source of the current time in Norte. Anything that reads a
// timestamp or waits for a deadline takes one, so a test can move time instead
// of sleeping through it; internal/core/clocktest is the implementation that
// does the moving.
type Clock interface {
	Now() time.Time
	// NewTimer returns a deadline d from now.
	NewTimer(d time.Duration) Timer
}

// Timer is one pending deadline: a channel that receives when it fires, and the
// way to abandon it. It is time.Timer's surface narrowed to what Norte uses, so
// that a manual clock can supply the same thing.
type Timer interface {
	// C receives once, when the timer fires.
	C() <-chan time.Time
	// Stop reports whether the timer was abandoned before it fired.
	Stop() bool
}

// SystemClock returns the Clock production runs on.
func SystemClock() Clock { return systemClock{} }

type systemClock struct{}

func (systemClock) Now() time.Time { return time.Now() }

func (systemClock) NewTimer(d time.Duration) Timer { return systemTimer{inner: time.NewTimer(d)} }

type systemTimer struct{ inner *time.Timer }

func (t systemTimer) C() <-chan time.Time { return t.inner.C }

func (t systemTimer) Stop() bool { return t.inner.Stop() }
