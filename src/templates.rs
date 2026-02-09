use once_cell::sync::Lazy;
use tera::Tera;

pub static TEMPLATES: Lazy<Tera> = Lazy::new(|| {
    let tera = match Tera::new("templates/**/*") {
        Ok(t) => t,
        Err(e) => {
            eprintln!("Error parsing templates: {}", e);
            std::process::exit(1);
        }
    };

    tera
});