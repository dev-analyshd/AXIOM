mod stress;

fn main() {
    let ok = stress::run_stress();
    std::process::exit(if ok { 0 } else { 1 });
}
