#!/usr/bin/env bash

SESSION="have-fish"

# Kill existing session if it exists
tmux kill-session -t "$SESSION" 2>/dev/null

# Get the directory of this script
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Create new session with first pane in backend
tmux new-session -d -s "$SESSION" -c "$DIR/backend"

# Split horizontally, second pane in frontend
tmux split-window -h -t "$SESSION" -c "$DIR/frontend"

# Run dev servers
tmux send-keys -t "$SESSION:0.0" "bun run dev" Enter
tmux send-keys -t "$SESSION:0.1" "bun run dev" Enter

# Attach to session
tmux attach-session -t "$SESSION"
