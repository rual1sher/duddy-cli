#!/usr/bin/env bash

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo -e "${BLUE}${BOLD}"
cat << "EOF"
    ____             __    __      
   / __ \__  ______  / /___/ /_  __
  / / / / / / / __ \/ __  / / / / /
 / /_/ / /_/ / /_/ / /_/ / /_/ /_/ 
/_____/\__,_/\__,_/\__,_/\__, (_)  
                         /____/    
EOF
echo -e "${NC}"
echo -e "${BOLD}🚀 Duddy Installer${NC}\n"

# 1. Check prerequisites
if ! command -v node >/dev/null 2>&1; then
    echo -e "${RED}❌ Ошибка: Node.js не установлен.${NC}"
    echo -e "Установи Node.js (v22+) и повтори установку: https://nodejs.org/"
    exit 1
fi

NODE_MAJOR=$(node -v | cut -d'.' -f1 | sed 's/v//')
if [ "$NODE_MAJOR" -lt 22 ]; then
    echo -e "${RED}❌ Ошибка: требуется Node.js 22+ (текущая: $(node -v))${NC}"
    echo -e "Обнови Node.js и повтори установку: https://nodejs.org/"
    exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
    echo -e "${RED}❌ Ошибка: npm не установлен.${NC}"
    exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
    echo -e "${RED}❌ Ошибка: curl не установлен.${NC}"
    exit 1
fi

if ! command -v tar >/dev/null 2>&1; then
    echo -e "${RED}❌ Ошибка: tar не установлен.${NC}"
    exit 1
fi

if ! command -v rg >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Предупреждение: ripgrep (rg) не установлен.${NC}"
    echo -e "Без ripgrep не работает поиск по проекту. Установка: https://github.com/BurntSushi/ripgrep#installation"
fi

# 2. Determine target directories
INSTALL_DIR="$HOME/.local/share/duddy"
VERSIONS_DIR="$INSTALL_DIR/versions"
BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"

# 3. Check if we are running inside the cloned repo
CURRENT_DIR="$(pwd)"
if [ -f "$CURRENT_DIR/bin/duddy.js" ] && [ -f "$CURRENT_DIR/package.json" ]; then
    echo -e "📦 Установка из локальной папки: ${GREEN}$CURRENT_DIR${NC}"
    TARGET_DIR="$CURRENT_DIR"
    echo -e "⏳ Установка зависимостей..."
    cd "$TARGET_DIR"
    npm install --silent --omit=dev 2>/dev/null || npm install --silent
    chmod +x "$TARGET_DIR/bin/duddy.js"
    ln -sf "$TARGET_DIR/bin/duddy.js" "$BIN_DIR/duddy"
    echo -e "🔗 Создан симлинк: ${GREEN}$BIN_DIR/duddy${NC}"
else
    # Remote / Curl mode (установка версиями без git clone)
    echo -e "📦 Загрузка Duddy в: ${GREEN}$INSTALL_DIR${NC}"

    if [ -d "$INSTALL_DIR/.git" ]; then
        echo -e "🔄 Обнаружена старая git-установка. Удаление старой папки $INSTALL_DIR..."
        rm -rf "$INSTALL_DIR"
    fi
    mkdir -p "$VERSIONS_DIR"

    TMP_DIR=$(mktemp -d)
    trap 'rm -rf "$TMP_DIR"' EXIT

    VER="${DUDDY_VERSION:-}"
    VER="${VER#v}"

    IS_MASTER_FALLBACK=false

    if [ -z "$VER" ]; then
        LATEST_JSON=$(curl -fsSL "https://api.github.com/repos/rual1sher/duddy-cli/releases/latest" 2>/dev/null || true)
        TAG_NAME=$(echo "$LATEST_JSON" | grep -m1 '"tag_name":' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/' || true)
        if [ -n "$TAG_NAME" ]; then
            VER="${TAG_NAME#v}"
        else
            IS_MASTER_FALLBACK=true
        fi
    fi

    mkdir -p "$TMP_DIR/src"

    if [ "$IS_MASTER_FALLBACK" = true ]; then
        echo -e "⬇️  Скачивание ветки master..."
        curl -fsSL "https://github.com/rual1sher/duddy-cli/archive/refs/heads/master.tar.gz" -o "$TMP_DIR/source.tar.gz"
        tar -xzf "$TMP_DIR/source.tar.gz" --strip-components=1 -C "$TMP_DIR/src"
        VER=$(grep -m1 '"version":' "$TMP_DIR/src/package.json" | sed -E 's/.*"version": *"([^"]+)".*/\1/' || true)
    else
        echo -e "⬇️  Скачивание релиза v${VER}..."
        curl -fsSL "https://github.com/rual1sher/duddy-cli/archive/refs/tags/v${VER}.tar.gz" -o "$TMP_DIR/source.tar.gz"
        tar -xzf "$TMP_DIR/source.tar.gz" --strip-components=1 -C "$TMP_DIR/src"
    fi

    if [[ ! "$VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo -e "${RED}❌ Некорректный формат версии: '$VER' (ожидается X.Y.Z)${NC}"
        exit 1
    fi

    TMP_VER_DIR="$VERSIONS_DIR/${VER}.tmp"
    DEST_VER_DIR="$VERSIONS_DIR/${VER}"
    rm -rf "$TMP_VER_DIR"
    mv "$TMP_DIR/src" "$TMP_VER_DIR"

    echo -e "⏳ Установка зависимостей..."
    cd "$TMP_VER_DIR"
    npm install --silent --omit=dev 2>/dev/null || npm install --silent

    rm -rf "$DEST_VER_DIR"
    mv "$TMP_VER_DIR" "$DEST_VER_DIR"

    PREV=$(basename "$(readlink "$INSTALL_DIR/current" 2>/dev/null)" 2>/dev/null || true)

    # Атомарно переключить $INSTALL_DIR/current → versions/$VER
    ln -sfn "versions/$VER" "$INSTALL_DIR/current.tmp"
    mv -Tf "$INSTALL_DIR/current.tmp" "$INSTALL_DIR/current"

    chmod +x "$DEST_VER_DIR/bin/duddy.js"
    ln -sf "$INSTALL_DIR/current/bin/duddy.js" "$BIN_DIR/duddy"
    echo -e "🔗 Создан симлинк: ${GREEN}$BIN_DIR/duddy${NC}"

    # Оставить ровно $VER и $PREV (если PREV не пустой и не равен VER), остальные папки (кроме *.tmp) удалить
    for dir in "$VERSIONS_DIR"/*; do
        [ -d "$dir" ] || continue
        base=$(basename "$dir")
        case "$base" in *.tmp) continue ;; esac
        if [ "$base" = "$VER" ]; then
            continue
        fi
        if [ -n "$PREV" ] && [ "$base" = "$PREV" ]; then
            continue
        fi
        rm -rf "$dir"
    done
fi

# 4. Check PATH
PATH_OK=false
case ":$PATH:" in
    *":$BIN_DIR:"*) PATH_OK=true ;;
esac

echo ""
echo -e "${GREEN}${BOLD}🎉 Duddy успешно установлен!${NC}"
echo ""

if [ "$PATH_OK" = false ]; then
    echo -e "${YELLOW}⚠️  Внимание: Папка $BIN_DIR пока не в твоем PATH.${NC}"
    echo -e "Добавь её, выполнив:"
    echo -e "  ${BOLD}echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc && source ~/.bashrc${NC}"
    echo -e "(или в ~/.zshrc, если используешь Zsh)"
    echo ""
fi

echo -e "Для запуска просто напиши:"
echo -e "  ${BOLD}${GREEN}duddy${NC}"
echo ""
