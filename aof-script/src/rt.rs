use deno_core::error::AnyError;
use deno_core::futures::Future;
use deno_core::url::{self, Url};
use deno_core::v8;
use deno_core::{JsRuntime, ModuleLoader, ModuleSource, ModuleSpecifier, OpState, RuntimeOptions};
use futures::FutureExt;
use std::cell::RefCell;
use std::collections::HashMap;
use std::pin::Pin;
use std::rc::Rc;
use thiserror::Error;

use crate::script_ctx::*;

const INITIAL_HEAP_SIZE: usize = 0;
const MAX_HEAP_SIZE: usize = 256 * 1024 * 1024; // 256 MiB

const MODULE_SOURCE_PREFIX: &str = "aof://";
const MODULE_SOURCE_EXEC_NAME: &str = "script_exec";
const MODULE_REPLACE_STR: &str = "###MODULE###";
const SCRIPT_PREFIX: &str = r#"var Deno = null;"#;

pub struct ScriptRt {
    runtime: JsRuntime,
}

impl ScriptRt {
    pub fn new(ctx: Rc<dyn ScriptContext>, mod_loader: ModLoader) -> Result<Self, AnyError> {
        let create_params =
            v8::CreateParams::default().heap_limits(INITIAL_HEAP_SIZE, MAX_HEAP_SIZE);

        let mod_loader: Rc<dyn deno_core::ModuleLoader> = Rc::new(mod_loader);

        let mut runtime = JsRuntime::new(RuntimeOptions {
            js_error_create_fn: None,
            get_error_class_fn: None,
            module_loader: Some(mod_loader),
            startup_snapshot: None,
            will_snapshot: false,
            create_params: Some(create_params),
        });

        crate::script_ctx::init_rt(&mut runtime, Rc::clone(&ctx));
        crate::ops::init(&mut runtime, ctx)?;

        Ok(ScriptRt { runtime })
    }

    pub async fn eval_module(&mut self, module: Url) -> Result<(), AnyError> {
        let module = ModuleSpecifier::from(module);
        let mod_id = self.runtime.load_module(&module, None).await?;
        self.runtime.mod_evaluate(mod_id).await?;
        Ok(())
    }

    pub async fn run_event_loop(&mut self) -> Result<(), AnyError> {
        self.runtime.run_event_loop().await?;
        Ok(())
    }
}

pub struct InnerScript {
    rt: ScriptRt,
    exec_module: Url,
}

impl InnerScript {
    pub fn create(
        ctx: Rc<dyn ScriptContext>,
        domain: &str,
        script: &str,
    ) -> Result<Self, AnyError> {
        let mut mod_spec = String::from(MODULE_SOURCE_PREFIX);
        mod_spec += domain;
        let mod_spec = Url::parse(&mod_spec).expect("Failed to create mod source url");

        let mut exec_spec = String::from(MODULE_SOURCE_PREFIX);
        exec_spec += MODULE_SOURCE_EXEC_NAME;
        let exec_spec = Url::parse(&exec_spec).unwrap();
        let exec_source = include_str!("exec.js")
            .replace(MODULE_REPLACE_STR, &mod_spec.as_str().replace("\"", "\\\""));

        let mut mod_loader = ModLoader::new();

        let script = String::from(SCRIPT_PREFIX) + script;

        mod_loader.insert(mod_spec.clone(), script);
        mod_loader.insert(exec_spec.clone(), exec_source);

        let rt = ScriptRt::new(ctx, mod_loader)?;

        Ok(InnerScript {
            rt,
            exec_module: exec_spec,
        })
    }

    pub async fn run(&mut self) -> Result<(), AnyError> {
        self.rt.eval_module(self.exec_module.clone()).await?;
        self.rt.run_event_loop().await?;
        Ok(())
    }
}

pub struct ModLoader {
    modules: HashMap<Url, String>,
}

impl ModLoader {
    pub fn new() -> Self {
        ModLoader {
            modules: HashMap::new(),
        }
    }

    pub fn insert(&mut self, url: Url, source: String) {
        self.modules.insert(url, source);
    }
}

#[derive(Debug, Error)]
enum ModLoadError {
    #[error("module “{0}” not found")]
    NotFound(Url),
}

impl ModuleLoader for ModLoader {
    fn resolve(
        &self,
        _: Rc<RefCell<OpState>>,
        specifier: &str,
        referrer: &str,
        _: bool,
    ) -> Result<ModuleSpecifier, AnyError> {
        match Url::parse(specifier) {
            Ok(url) => Ok(ModuleSpecifier::from(url)),
            Err(url::ParseError::RelativeUrlWithoutBase) => {
                let base = Url::parse(referrer)?;
                Ok(ModuleSpecifier::from(base.join(specifier)?))
            }
            Err(err) => Err(err.into()),
        }
    }

    fn load(
        &self,
        _: Rc<RefCell<OpState>>,
        specifier: &ModuleSpecifier,
        _: Option<ModuleSpecifier>,
        _: bool,
    ) -> Pin<Box<dyn Future<Output = Result<ModuleSource, AnyError>>>> {
        let url = specifier.as_url().clone();
        let module = self.modules.get(&url).map(Clone::clone);

        async move {
            match module {
                Some(source) => Ok(ModuleSource {
                    code: source,
                    module_url_specified: url.to_string(),
                    module_url_found: url.to_string(),
                }),
                None => Err(ModLoadError::NotFound(url).into()),
            }
        }
        .boxed()
    }
}
