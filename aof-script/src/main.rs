use aof_script::{url, ModLoader, ScriptRt, UnrestrictedContext};
use futures::{FutureExt, StreamExt};
use std::sync::Arc;

async fn run() {
    let ctx = UnrestrictedContext;
    let mut mod_loader = ModLoader::new();

    let mut source = String::new();
    std::io::Read::read_to_string(&mut std::io::stdin(), &mut source).unwrap();

    let mod_spec = "file:///main.js";
    let mod_spec = url::Url::parse(mod_spec).unwrap();

    mod_loader.insert(mod_spec.clone(), source);

    let mut rt = ScriptRt::new(Arc::new(ctx), mod_loader).expect("Failed to initialize runtime");
    let mut module = rt.eval_module(mod_spec).await.unwrap();
    rt.run_event_loop().await.unwrap();
    while let Some(next) = module.next().await {
        next.unwrap();
    }
}

fn main() {
    smol::block_on(run());
}
