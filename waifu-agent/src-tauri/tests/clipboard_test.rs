#[test]
fn test_clipboard() {
    let mut cb = arboard::Clipboard::new().expect("open clipboard");
    match cb.get_text() {
        Ok(t) => {
            let preview: String = t.chars().take(200).collect();
            println!("剪贴板内容 ({} chars):\n---\n{}", t.len(), preview);
            if t.len() > 200 { println!("...(truncated)"); }
            println!("---");
        }
        Err(e) => println!("读取失败: {}", e),
    }
}
