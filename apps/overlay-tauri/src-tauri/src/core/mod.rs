//! The overlay's pure logic: no window, no clock, no disk of its own, so it is
//! checked by `cargo test` on any platform.

pub mod choices;
pub mod files;
pub mod geometry;
pub mod http;
pub mod icon;
pub mod registry;
pub mod snapshot;
