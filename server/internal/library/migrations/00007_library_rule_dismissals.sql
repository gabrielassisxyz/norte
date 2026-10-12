-- The dismissed rule suggestions: domains the person has seen suggested and
-- said no to, so the suggestion endpoint never offers them again.
--
-- A dismissal is one row per normalized domain, recorded when the person
-- dismisses a suggestion through the API or the command line. Setting a rule
-- for the domain afterwards still works: the two tables are read
-- independently, and a rule suppresses its domains whether or not they were
-- dismissed. Removing the rule later leaves the dismissal in place, so the
-- domain stays unsuggested until the row is gone.
--
-- A standalone table and not a column, because a dismissal is about a domain
-- that has no rule: there is no rule row to hang it on.
--
-- +goose Up

CREATE TABLE library_domain_rule_dismissals (
    domain      TEXT PRIMARY KEY,
    dismissed_at TEXT NOT NULL
);

-- +goose Down

DROP TABLE library_domain_rule_dismissals;
