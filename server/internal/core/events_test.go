package core_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

func TestEventsCallSubscribersInRegistrationOrder(t *testing.T) {
	events := core.NewEvents()
	var called []string
	for _, name := range []string{"first", "second", "third"} {
		events.Subscribe("library.item_extracted", func(_ context.Context, _ core.Event) error {
			called = append(called, name)
			return nil
		})
	}
	if err := events.Publish(context.Background(), core.Event{
		Name:    "library.item_extracted",
		Payload: map[string]string{"item_id": "abc"},
	}); err != nil {
		t.Fatalf("Publish: %v", err)
	}
	if got := strings.Join(called, ","); got != "first,second,third" {
		t.Errorf("subscribers ran %q, want first,second,third", got)
	}
}

func TestEventsOnlyReachSubscribersOfThatName(t *testing.T) {
	events := core.NewEvents()
	other := 0
	events.Subscribe("library.item_saved", func(context.Context, core.Event) error {
		other++
		return nil
	})
	matching := 0
	events.Subscribe("library.item_extracted", func(context.Context, core.Event) error {
		matching++
		return nil
	})
	if err := events.Publish(context.Background(), core.Event{Name: "library.item_extracted"}); err != nil {
		t.Fatalf("Publish: %v", err)
	}
	if matching != 1 {
		t.Errorf("the matching subscriber ran %d times, want 1", matching)
	}
	if other != 0 {
		t.Errorf("a subscriber of another event ran %d times, want 0", other)
	}
}

func TestEventsPublishReportsEverySubscriberFailure(t *testing.T) {
	events := core.NewEvents()
	first := errors.New("the first reaction failed")
	second := errors.New("the second reaction failed")
	events.Subscribe("library.item_extracted", func(context.Context, core.Event) error { return first })
	ranAfter := false
	events.Subscribe("library.item_extracted", func(context.Context, core.Event) error { return second })
	events.Subscribe("library.item_extracted", func(context.Context, core.Event) error {
		ranAfter = true
		return nil
	})
	err := events.Publish(context.Background(), core.Event{Name: "library.item_extracted"})
	if !errors.Is(err, first) || !errors.Is(err, second) {
		t.Fatalf("Publish error = %v, want both subscriber errors", err)
	}
	if !ranAfter {
		// A failing subscriber must not stop the ones registered after it: the
		// publisher returns one aggregate so the replay retries them all.
		t.Error("a subscriber registered after a failing one did not run")
	}
}

func TestEventsTurnASubscriberPanicIntoAnError(t *testing.T) {
	events := core.NewEvents()
	events.Subscribe("library.item_extracted", func(context.Context, core.Event) error {
		panic("a subscriber exploded")
	})
	reached := false
	events.Subscribe("library.item_extracted", func(context.Context, core.Event) error {
		reached = true
		return nil
	})
	err := events.Publish(context.Background(), core.Event{Name: "library.item_extracted"})
	if err == nil || !strings.Contains(err.Error(), "a subscriber exploded") {
		t.Fatalf("Publish error = %v, want the panic reported as an error", err)
	}
	if !reached {
		t.Error("the subscriber after the panicking one did not run")
	}
}

func TestEventsPublishWithNoSubscribersSucceeds(t *testing.T) {
	if err := core.NewEvents().Publish(context.Background(), core.Event{Name: "library.item_extracted"}); err != nil {
		t.Fatalf("Publish with nothing subscribed: %v", err)
	}
}

func TestEventsPublishSnapshotsTheSubscriberList(t *testing.T) {
	events := core.NewEvents()
	added := 0
	events.Subscribe("library.item_extracted", func(ctx context.Context, _ core.Event) error {
		events.Subscribe("library.item_extracted", func(context.Context, core.Event) error {
			added++
			return nil
		})
		return nil
	})
	if err := events.Publish(context.Background(), core.Event{Name: "library.item_extracted"}); err != nil {
		t.Fatalf("Publish: %v", err)
	}
	if added != 0 {
		t.Errorf("a subscriber added during the publish ran %d times, want 0", added)
	}
	if err := events.Publish(context.Background(), core.Event{Name: "library.item_extracted"}); err != nil {
		t.Fatalf("second Publish: %v", err)
	}
	if added != 1 {
		t.Errorf("the subscriber added during the first publish ran %d times in the second, want 1", added)
	}
}
