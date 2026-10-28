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
    echo -e "Установи Node.js (v18+) и повтори установку: https://nodejs.org/"
    exit 1
fi

NODE_MAJOR=$(node -v | cut -d'.' -f1 | sed 's/v//')
if [ "$NODE_MAJOR" -lt 18 ]; then
    echo -e "${YELLOW}⚠️  Предупреждение: рекомендуется Node.js 18+ (текущая: $(node -v))${NC}"
fi

if ! command -v npm >/dev/null 2>&1; then
    echo -e "${RED}❌ Ошибка: npm не установлен.${NC}"
    exit 1
fi

# 2. Determine target directories
INSTALL_DIR="$HOME/.local/share/duddy"
BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"

# 3. Check if we are running inside the cloned repo
CURRENT_DIR="$(pwd)"
if [ -f "$CURRENT_DIR/bin/duddy.js" ] && [ -f "$CURRENT_DIR/package.json" ]; then
    echo -e "📦 Установка из локальной папки: ${GREEN}$CURRENT_DIR${NC}"
    TARGET_DIR="$CURRENT_DIR"
else
    # Remote / Curl mode
    echo -e "📦 Загрузка Duddy в: ${GREEN}$INSTALL_DIR${NC}"
    if ! command -v git >/dev/null 2>&1; then
        echo -e "${RED}❌ Ошибка: git не установлен.${NC}"
        exit 1
    fi

    REPO_URL="${DUDDY_REPO_URL:-https://github.com/rual1sher/duddy-cli.git}"

    if [ -d "$INSTALL_DIR/.git" ]; then
        echo -e "🔄 Обновление существующей версии..."
        cd "$INSTALL_DIR"
        git pull --quiet
    else
        rm -rf "$INSTALL_DIR"
        echo -e "⬇️  Клонирование репозитория..."
        git clone --quiet "$REPO_URL" "$INSTALL_DIR"
        cd "$INSTALL_DIR"
    fi
    TARGET_DIR="$INSTALL_DIR"
fi

# 4. Install dependencies
echo -e "⏳ Установка зависимостей..."
cd "$TARGET_DIR"
npm install --silent --omit=dev 2>/dev/null || npm install --silent

# 5. Make executable and symlink
chmod +x "$TARGET_DIR/bin/duddy.js"
ln -sf "$TARGET_DIR/bin/duddy.js" "$BIN_DIR/duddy"

echo -e "🔗 Создан симлинк: ${GREEN}$BIN_DIR/duddy${NC}"

# 6. Check PATH
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
