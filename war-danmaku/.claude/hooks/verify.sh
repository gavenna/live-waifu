#!/bin/bash
# Stop Hook: 验证代码语法正确性
# 根据 git diff 检测改动的文件类型，运行对应的编译检查

cd "$CLAUDE_PROJECT_DIR" || exit 0

# 获取本次会话改动的文件
changed=$(git diff --name-only HEAD 2>/dev/null)
if [ -z "$changed" ]; then
    # 还没有 commit，检查 working tree
    changed=$(git diff --name-only 2>/dev/null)
fi

has_js=0
has_py=0

for f in $changed; do
    case "$f" in
        *.js)   has_js=1 ;;
        *.py)   has_py=1 ;;
    esac
done

exit_code=0

# JS 语法检查
if [ $has_js -eq 1 ]; then
    echo "[verify] Checking JS syntax..."
    # 检查 server/ 和 frontend/ 下的所有 JS 文件
    for f in server/*.js frontend/*.js; do
        if [ -f "$f" ]; then
            result=$(node --check "$f" 2>&1)
            if [ $? -ne 0 ]; then
                echo "[verify] ✗ $f"
                echo "$result"
                exit_code=1
            fi
        fi
    done
    if [ $exit_code -eq 0 ]; then
        echo "[verify] ✓ JS syntax OK"
    fi
fi

# Python 语法检查（hook 脚本）
if [ $has_py -eq 1 ]; then
    echo "[verify] Checking Python syntax..."
    for f in .claude/hooks/*.py; do
        if [ -f "$f" ]; then
            python -m py_compile "$f" 2>&1
            if [ $? -ne 0 ]; then
                exit_code=1
            fi
        fi
    done
fi

exit $exit_code
