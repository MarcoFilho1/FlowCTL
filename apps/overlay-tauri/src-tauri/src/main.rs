// No console window behind the overlay on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    flowctl_overlay::run();
}
