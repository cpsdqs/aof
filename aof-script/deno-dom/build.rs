use std::env;
use std::process::Command;

fn main() {
    let cwd = env::current_dir().expect("No cwd?");
    let mut js_cwd = cwd.clone();
    js_cwd.push("deno-dom-js");
    env::set_current_dir(js_cwd).expect("Failed to cd");

    println!("cargo:rerun-if-changed=deno-dom-js/index.ts");
    println!("cargo:rerun-if-changed=deno-dom-js/rollup.config.mjs");

    let status = Command::new("npm")
        .args(&["install"])
        .status()
        .expect("Failed to init npm");
    assert!(status.success(), "Failed to init npm");

    let status = Command::new("npm")
        .args(&["run", "build"])
        .status()
        .expect("Failed to build JS");
    assert!(status.success(), "Failed to build JS");
}
