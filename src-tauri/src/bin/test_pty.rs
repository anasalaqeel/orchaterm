use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::thread;

fn main() {
    println!("=== PTY DIAGNOSTIC TEST ===");
    let pty_system = native_pty_system();

    println!("1. Opening PTY pair (80x24)...");
    let pair = match pty_system.openpty(PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    }) {
        Ok(p) => p,
        Err(e) => {
            println!("ERROR opening PTY: {:?}", e);
            return;
        }
    };

    println!("2. Spawning powershell.exe...");
    let cmd = CommandBuilder::new("cmd.exe");
    let mut child = match pair.slave.spawn_command(cmd) {
        Ok(c) => c,
        Err(e) => {
            println!("ERROR spawning cmd: {:?}", e);
            return;
        }
    };
    drop(pair.slave);

    println!("3. Cloning reader and taking writer...");
    let mut reader = match pair.master.try_clone_reader() {
        Ok(r) => r,
        Err(e) => {
            println!("ERROR cloning reader: {:?}", e);
            return;
        }
    };
    let mut writer = match pair.master.take_writer() {
        Ok(w) => w,
        Err(e) => {
            println!("ERROR taking writer: {:?}", e);
            return;
        }
    };

    println!("4. Starting background reader thread...");
    thread::spawn(move || {
        println!("[Reader Thread] Spawned and running...");
        let mut buffer = [0u8; 4096];
        loop {
            println!("[Reader Thread] Calling reader.read...");
            match reader.read(&mut buffer) {
                Ok(n) if n > 0 => {
                    let text = String::from_utf8_lossy(&buffer[..n]);
                    println!("[Reader Thread] Read {} bytes: {:?}", n, text);
                    print!("{}", text);
                    let _ = std::io::stdout().flush();
                }
                Ok(_) => {
                    println!("\n[Reader Thread] EOF reached");
                    break;
                }
                Err(e) => {
                    println!("\n[Reader Thread] Error: {:?}", e);
                    break;
                }
            }
        }
        println!("[Reader Thread] Exiting...");
    });

    println!("5. Writing 'echo PTY_TEST_OK' to PTY writer...");
    if let Err(e) = writer.write_all(b"echo PTY_TEST_OK\r\n") {
        println!("Error writing command: {:?}", e);
    }
    let _ = writer.flush();

    println!("6. Waiting 2 seconds for output...");
    thread::sleep(std::time::Duration::from_secs(2));

    println!("7. Terminating child...");
    let _ = child.kill();
    println!("Test finished successfully!");
}
