// Package clocktest is the manual clock Norte's tests run on: time moves only
// when a test moves it, and a timer fires on the line that moved it.
package clocktest

import (
	"sync"
	"time"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// Clock implements core.Clock over an instant the test owns.
type Clock struct {
	mu     sync.Mutex
	now    time.Time
	timers []*manualTimer
}

// New returns a Clock reading start.
func New(start time.Time) *Clock { return &Clock{now: start} }

// Now reports the instant the test last set.
func (c *Clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

// NewTimer registers a deadline d from the clock's current instant. It fires on
// the Advance that reaches it, and never otherwise.
func (c *Clock) NewTimer(d time.Duration) core.Timer {
	c.mu.Lock()
	defer c.mu.Unlock()
	timer := &manualTimer{deadline: c.now.Add(d), fired: make(chan time.Time, 1)}
	c.timers = append(c.timers, timer)
	return timer
}

// PendingTimers reports how many timers are registered that a future Advance
// would fire: armed and not yet reached, and not stopped. A test waits on it
// until a worker goroutine has parked on the clock, so the next Advance fires
// a timer the worker is actually waiting on instead of moving time nobody
// observes. Stopped timers are skipped: Stop marks them dead but leaves them
// listed until an Advance passes their deadline.
func (c *Clock) PendingTimers() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	pending := 0
	for _, timer := range c.timers {
		timer.mu.Lock()
		stopped := timer.stopped
		timer.mu.Unlock()
		if !stopped {
			pending++
		}
	}
	return pending
}

// Advance moves the clock forward and fires every timer that is due, before it
// returns. Firing synchronously is the reason this type exists: a test asserts
// on the effect of a deadline on the line after it moves time, with no sleep
// and no polling anywhere.
func (c *Clock) Advance(d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	now := c.now
	var due []*manualTimer
	pending := c.timers[:0]
	for _, timer := range c.timers {
		if timer.deadline.After(now) {
			pending = append(pending, timer)
			continue
		}
		due = append(due, timer)
	}
	c.timers = pending
	c.mu.Unlock()

	// Outside the lock: a receiver woken by one timer may ask this clock for
	// another, and holding the lock across the send would deadlock on that.
	for _, timer := range due {
		timer.fire(now)
	}
}

type manualTimer struct {
	deadline time.Time
	fired    chan time.Time

	mu      sync.Mutex
	stopped bool
	rang    bool
}

func (t *manualTimer) C() <-chan time.Time { return t.fired }

func (t *manualTimer) Stop() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.stopped || t.rang {
		return false
	}
	t.stopped = true
	return true
}

// fire never blocks: the channel holds one value and a timer sends once.
func (t *manualTimer) fire(now time.Time) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.stopped || t.rang {
		return
	}
	t.rang = true
	t.fired <- now
}
