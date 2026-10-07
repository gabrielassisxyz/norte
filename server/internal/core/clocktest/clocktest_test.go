package clocktest_test

import (
	"testing"
	"time"

	"github.com/gabrielassisxyz/norte/server/internal/core/clocktest"
)

var start = time.Date(2026, 3, 9, 17, 0, 0, 0, time.UTC)

// TestATimerFiresOnlyOnceItsDeadlineIsReached is the property every later bead's
// scheduling test rests on: a deadline that is nearly due has not happened. A
// clock that fired on any Advance would make those tests pass whatever interval
// the code asked for.
func TestATimerFiresOnlyOnceItsDeadlineIsReached(t *testing.T) {
	clock := clocktest.New(start)
	timer := clock.NewTimer(2 * time.Minute)

	clock.Advance(119 * time.Second)
	select {
	case fired := <-timer.C():
		t.Fatalf("a 2-minute timer fired after 119s, reporting %s", fired)
	default:
	}

	clock.Advance(time.Second)
	select {
	case fired := <-timer.C():
		if want := start.Add(2 * time.Minute); !fired.Equal(want) {
			t.Errorf("the timer reported %s, want the deadline %s", fired, want)
		}
	default:
		t.Fatal("a 2-minute timer did not fire on the Advance that reached 2 minutes")
	}
}

func TestAdvanceMovesNow(t *testing.T) {
	clock := clocktest.New(start)
	if got := clock.Now(); !got.Equal(start) {
		t.Fatalf("Now() = %s before any Advance, want %s", got, start)
	}
	clock.Advance(90 * time.Minute)
	if want := start.Add(90 * time.Minute); !clock.Now().Equal(want) {
		t.Errorf("Now() = %s after Advance(90m), want %s", clock.Now(), want)
	}
}

func TestAStoppedTimerNeverFires(t *testing.T) {
	clock := clocktest.New(start)
	timer := clock.NewTimer(time.Minute)

	if !timer.Stop() {
		t.Fatal("Stop() on a pending timer = false, want true")
	}
	clock.Advance(time.Hour)
	select {
	case fired := <-timer.C():
		t.Fatalf("a stopped timer fired, reporting %s", fired)
	default:
	}
	if timer.Stop() {
		t.Error("Stop() on an already stopped timer = true, want false")
	}
}
