#!/usr/bin/env node

const { exec, spawn } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

async function getBranches() {
  const { stdout } = await execAsync('git branch --format="%(refname:short) %(HEAD)"');
  const lines = stdout.trim().split('\n').filter(line => line.trim());
  const branches = [];
  let currentIndex = 0;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const isCurrent = trimmed.endsWith('*');
    const name = isCurrent ? trimmed.slice(0, -1).trim() : trimmed;
    branches.push(name);
    if (isCurrent) {
      currentIndex = index;
    }
  });

  return { branches, currentIndex };
}

function render(branches, selectedIndex, currentBranch, message = '') {
  // \u001b[2J 清屏，\u001b[H 将光标移动到左上角
  process.stdout.write('\u001b[2J\u001b[H');
  console.log('选择分支: ↓/J, ↑/K; 切换分支: Enter; 删除分支: Ctrl+K; 退出: Q/Esc/Ctrl+C \n');
  if (message) {
    console.log(message + '\n');
  }

  branches.forEach((branch, index) => {
    const marker = index === selectedIndex ? '>' : ' ';
    const line = `${marker} ${branch}`;
    if (index === selectedIndex) {
      // \u001b[7m 开启反色显示（高亮），\u001b[0m 重置样式
      // \u001b[32m 设置前景色为绿色，用于标识当前所在的分支
      const green = branch === currentBranch ? '\u001b[32m' : '';
      process.stdout.write(`\u001b[7m${green}${line}\u001b[0m\n`);
    } else if (branch === currentBranch) {
      // \u001b[32m 设置前景色为绿色，\u001b[0m 重置样式
      process.stdout.write(`\u001b[32m${line}\u001b[0m\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  });
}

async function switchBranch(branchName) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['checkout', branchName], {
      stdio: 'inherit'
    });
    child.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`git checkout 退出码: ${code}`));
      }
    });
  });
}

async function deleteBranch(branchName) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['branch', '-D', branchName], {
      stdio: 'inherit'
    });
    child.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`git branch -D 退出码: ${code}`));
      }
    });
  });
}

async function main() {
  try {
    let { branches, currentIndex } = await getBranches();
    if (branches.length === 0) {
      console.log('没有可切换的分支。');
      process.exit(0);
    }

    let selectedIndex = currentIndex;
    let currentBranch = branches[currentIndex];
    let busy = false;
    render(branches, selectedIndex, currentBranch);

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    // \u001b[?25l 隐藏光标，避免界面闪烁
    process.stdout.write('\u001b[?25l');

    process.stdin.on('data', async (key) => {
      // \u0003 表示 Ctrl+C 键
      if (key === '\u0003') {
        // \u001b[?25h 显示光标
        process.stdout.write('\u001b[?25h');
        // \u001b[2J 清屏，\u001b[H 将光标移动到左上角
        process.stdout.write('\u001b[2J\u001b[H');
        process.exit(0);
      }

      // \u001b 表示 Esc 键，Q/q 也表示退出程序
      if (key === '\u001b' || key === 'Q' || key === 'q') {
        // \u001b[?25h 显示光标
        process.stdout.write('\u001b[?25h');
        // \u001b[2J 清屏，\u001b[H 将光标移动到左上角
        process.stdout.write('\u001b[2J\u001b[H');
        process.exit(0);
      }

      // \u000b 表示 Ctrl+K 键（终端中 Command+K 组合键的等效按键），用于删除当前选中的分支
      if (key === '\u000b') {
        if (busy) {
          return;
        }
        busy = true;
        const branchToDelete = branches[selectedIndex];
        let message;
        // 当前 checkout 的分支不允许删除
        if (branchToDelete === currentBranch) {
          message = `无法删除当前所在的分支: ${branchToDelete}`;
        } else {
          try {
            await deleteBranch(branchToDelete);
            // 删除成功后重新获取分支列表并刷新
            const refreshed = await getBranches();
            branches = refreshed.branches;
            currentBranch = refreshed.branches[refreshed.currentIndex];
            if (branches.length === 0) {
              // \u001b[?25h 显示光标
              process.stdout.write('\u001b[?25h');
              // \u001b[2J 清屏，\u001b[H 将光标移动到左上角
              process.stdout.write('\u001b[2J\u001b[H');
              console.log('所有分支已删除。');
              process.exit(0);
            }
            if (selectedIndex >= branches.length) {
              selectedIndex = branches.length - 1;
            }
            message = `已删除分支: ${branchToDelete}`;
          } catch (err) {
            message = `删除分支失败: ${err.message}`;
          }
        }
        busy = false;
        render(branches, selectedIndex, currentBranch, message);
        return;
      }

      // \u001b[A 表示向上箭头键，K/k 也表示向上移动
      if (key === '\u001b[A' || key === 'K' || key === 'k') {
        selectedIndex = (selectedIndex - 1 + branches.length) % branches.length;
        render(branches, selectedIndex, currentBranch);
      // \u001b[B 表示向下箭头键，J/j 也表示向下移动
      } else if (key === '\u001b[B' || key === 'J' || key === 'j') {
        selectedIndex = (selectedIndex + 1) % branches.length;
        render(branches, selectedIndex, currentBranch);
      } else if (key === '\r' || key === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        // \u001b[?25h 显示光标
        process.stdout.write('\u001b[?25h');
        // \u001b[2J 清屏，\u001b[H 将光标移动到左上角
        process.stdout.write('\u001b[2J\u001b[H');
        const selectedBranch = branches[selectedIndex];
        try {
          await switchBranch(selectedBranch);
          console.log(`已切换到分支: ${selectedBranch}`);
          process.exit(0);
        } catch (err) {
          console.error(err.message);
          process.exit(1);
        }
      }
    });
  } catch (err) {
    // \u001b[?25h 显示光标
    process.stdout.write('\u001b[?25h');
    console.error('错误:', err.message);
    process.exit(1);
  }
}

main();
