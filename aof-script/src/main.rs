use aof_script::{url, ModLoader, ScriptRt, UnrestrictedContext};
use std::rc::Rc;

async fn run() {
    let ctx = UnrestrictedContext;
    let mut mod_loader = ModLoader::new();

    let mut source = String::new();
    std::io::Read::read_to_string(&mut std::io::stdin(), &mut source).unwrap();

    let mod_spec = "file:///main.js";
    let mod_spec = url::Url::parse(mod_spec).unwrap();

    mod_loader.insert(mod_spec.clone(), source);

    let mut rt = ScriptRt::new(Rc::new(ctx), mod_loader).expect("Failed to initialize runtime");
    rt.eval_module(mod_spec).await.unwrap();
    rt.run_event_loop().await.unwrap();
}

fn main() {
    smol::block_on(run());
}
