//! Per-check alert state machine. Pure logic, time is injected.

use std::time::{Duration, Instant};

#[derive(Debug, PartialEq, Eq)]
pub enum Action {
    None,
    /// Check failed continuously for the whole window: send an alert.
    Alert { down_for: Duration },
    /// Check is healthy again after an alert was sent.
    Recovered,
}

#[derive(Debug, Default)]
pub struct CheckState {
    first_fail: Option<Instant>,
    alerted: bool,
    last_alert: Option<Instant>,
}

impl CheckState {
    pub fn observe(&mut self, now: Instant, ok: bool, window: Duration, repeat: Duration) -> Action {
        if ok {
            let was_alerted = self.alerted;
            *self = CheckState::default();
            return if was_alerted { Action::Recovered } else { Action::None };
        }
        let first = *self.first_fail.get_or_insert(now);
        let down_for = now.duration_since(first);
        if down_for < window {
            return Action::None;
        }
        let due = match self.last_alert {
            None => true,
            Some(t) => !repeat.is_zero() && now.duration_since(t) >= repeat,
        };
        if due { Action::Alert { down_for } } else { Action::None }
    }

    /// Call only after the SMS was really delivered; otherwise the alert is
    /// retried in the next round.
    pub fn mark_alerted(&mut self, now: Instant) {
        self.alerted = true;
        self.last_alert = Some(now);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: Duration = Duration::from_secs(120);
    const NO: Duration = Duration::ZERO;

    fn t(base: Instant, s: u64) -> Instant {
        base + Duration::from_secs(s)
    }

    #[test]
    fn alert_only_after_full_window() {
        let b = Instant::now();
        let mut s = CheckState::default();
        assert_eq!(s.observe(t(b, 0), false, W, NO), Action::None);
        assert_eq!(s.observe(t(b, 119), false, W, NO), Action::None);
        assert!(matches!(s.observe(t(b, 120), false, W, NO), Action::Alert { .. }));
    }

    #[test]
    fn success_resets_window() {
        let b = Instant::now();
        let mut s = CheckState::default();
        s.observe(t(b, 0), false, W, NO);
        s.observe(t(b, 100), true, W, NO);
        assert_eq!(s.observe(t(b, 110), false, W, NO), Action::None);
        assert_eq!(s.observe(t(b, 200), false, W, NO), Action::None);
        assert!(matches!(s.observe(t(b, 230), false, W, NO), Action::Alert { .. }));
    }

    #[test]
    fn single_alert_until_recovery() {
        let b = Instant::now();
        let mut s = CheckState::default();
        s.observe(t(b, 0), false, W, NO);
        assert!(matches!(s.observe(t(b, 120), false, W, NO), Action::Alert { .. }));
        s.mark_alerted(t(b, 120));
        assert_eq!(s.observe(t(b, 135), false, W, NO), Action::None);
        assert_eq!(s.observe(t(b, 600), true, W, NO), Action::Recovered);
        assert_eq!(s.observe(t(b, 615), true, W, NO), Action::None);
    }

    #[test]
    fn failed_sms_is_retried() {
        let b = Instant::now();
        let mut s = CheckState::default();
        s.observe(t(b, 0), false, W, NO);
        assert!(matches!(s.observe(t(b, 120), false, W, NO), Action::Alert { .. }));
        // not marked: next round tries again
        assert!(matches!(s.observe(t(b, 135), false, W, NO), Action::Alert { .. }));
    }

    #[test]
    fn repeat_alert() {
        let b = Instant::now();
        let r = Duration::from_secs(600);
        let mut s = CheckState::default();
        s.observe(t(b, 0), false, W, r);
        s.observe(t(b, 120), false, W, r);
        s.mark_alerted(t(b, 120));
        assert_eq!(s.observe(t(b, 500), false, W, r), Action::None);
        assert!(matches!(s.observe(t(b, 720), false, W, r), Action::Alert { .. }));
    }
}
