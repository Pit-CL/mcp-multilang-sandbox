/**
 * Seccomp Profiles for Container Security
 *
 * Seccomp (Secure Computing Mode) restricts which syscalls a process can make.
 * These profiles are tailored for each language runtime to allow only necessary syscalls.
 */

import type { Language } from '../types/index.js';

// Docker seccomp profile format
export interface SeccompProfile {
  defaultAction: 'SCMP_ACT_ALLOW' | 'SCMP_ACT_ERRNO' | 'SCMP_ACT_KILL';
  architectures: string[];
  syscalls: SeccompRule[];
}

export interface SeccompRule {
  names: string[];
  action: 'SCMP_ACT_ALLOW' | 'SCMP_ACT_ERRNO' | 'SCMP_ACT_KILL' | 'SCMP_ACT_LOG';
  errnoRet?: number;
}

// Dangerous syscalls that should NEVER be allowed in sandbox
const BLOCKED_SYSCALLS = [
  // Kernel/system modification
  'kexec_load',
  'kexec_file_load',
  'reboot',
  'swapon',
  'swapoff',
  'syslog',
  'acct',
  'settimeofday',
  'adjtimex',
  'clock_adjtime',
  'clock_settime',

  // Module loading
  'init_module',
  'finit_module',
  'delete_module',
  'create_module',

  // Process tracing (anti-debugging bypass)
  'ptrace',
  'process_vm_readv',
  'process_vm_writev',

  // Keyring (credential theft)
  'keyctl',
  'add_key',
  'request_key',

  // Namespace manipulation (container escape)
  'unshare',
  'setns',

  // Mount operations (container escape)
  'mount',
  'umount',
  'umount2',
  'pivot_root',

  // Raw I/O (disk destruction)
  'ioperm',
  'iopl',

  // Dangerous personality
  'personality',

  // BPF (kernel exploitation)
  'bpf',

  // Userfaultfd (exploitation primitive)
  'userfaultfd',

  // Perf (side-channel attacks)
  'perf_event_open',

  // Lookup dcookie (information leak)
  'lookup_dcookie',

  // Open by handle (escape chroot)
  'open_by_handle_at',
  'name_to_handle_at',
];

// Base allowed syscalls for all languages
const BASE_ALLOWED_SYSCALLS = [
  // Process basics
  'read', 'write', 'open', 'close', 'stat', 'fstat', 'lstat',
  'poll', 'lseek', 'mmap', 'mprotect', 'munmap', 'brk',
  'pread64', 'pwrite64', 'readv', 'writev',

  // File operations
  'access', 'pipe', 'select', 'dup', 'dup2', 'dup3',
  'fcntl', 'flock', 'fsync', 'fdatasync', 'truncate', 'ftruncate',
  'getdents', 'getdents64', 'getcwd', 'chdir', 'fchdir',
  'rename', 'renameat', 'renameat2', 'mkdir', 'mkdirat', 'rmdir',
  'link', 'linkat', 'unlink', 'unlinkat', 'symlink', 'symlinkat',
  'readlink', 'readlinkat', 'chmod', 'fchmod', 'fchmodat',
  'chown', 'fchown', 'lchown', 'fchownat',
  'umask', 'statfs', 'fstatfs', 'utime', 'utimes', 'utimensat', 'futimesat',
  'openat', 'newfstatat', 'faccessat', 'faccessat2',

  // Memory
  'madvise', 'mincore', 'mremap', 'msync', 'mlock', 'munlock',
  'mlockall', 'munlockall', 'memfd_create', 'membarrier',

  // Process/thread
  'exit', 'exit_group', 'wait4', 'waitid',
  'clone', 'clone3', 'fork', 'vfork', 'execve', 'execveat',
  'getpid', 'getppid', 'gettid', 'getuid', 'geteuid',
  'getgid', 'getegid', 'getgroups', 'setgroups',
  'getpgid', 'setpgid', 'getpgrp', 'setsid', 'getsid',
  'getrlimit', 'setrlimit', 'prlimit64', 'getrusage',
  'sched_yield', 'sched_getaffinity', 'sched_setaffinity',
  'sched_getscheduler', 'sched_setscheduler',
  'sched_getparam', 'sched_setparam',
  'sched_get_priority_min', 'sched_get_priority_max',
  'sched_rr_get_interval',

  // Signals
  'rt_sigaction', 'rt_sigprocmask', 'rt_sigreturn',
  'rt_sigpending', 'rt_sigtimedwait', 'rt_sigsuspend', 'rt_sigqueueinfo',
  'sigaltstack', 'kill', 'tgkill', 'tkill',

  // Time
  'nanosleep', 'clock_nanosleep', 'clock_gettime', 'clock_getres',
  'gettimeofday', 'time', 'times',

  // Futex (threading)
  'futex', 'set_robust_list', 'get_robust_list',

  // IPC
  'pipe2', 'eventfd', 'eventfd2', 'timerfd_create', 'timerfd_settime', 'timerfd_gettime',
  'signalfd', 'signalfd4', 'epoll_create', 'epoll_create1',
  'epoll_ctl', 'epoll_wait', 'epoll_pwait', 'epoll_pwait2',
  'inotify_init', 'inotify_init1', 'inotify_add_watch', 'inotify_rm_watch',

  // Architecture specific
  'arch_prctl', 'prctl', 'set_tid_address', 'set_thread_area', 'get_thread_area',

  // Misc required
  'getrandom', 'ioctl', 'uname', 'sysinfo',
  'getxattr', 'lgetxattr', 'fgetxattr', 'listxattr', 'llistxattr', 'flistxattr',
  'setxattr', 'lsetxattr', 'fsetxattr', 'removexattr', 'lremovexattr', 'fremovexattr',
  'capget', 'capset',
  'seccomp',
  'rseq',
  'pselect6', 'ppoll',
  'copy_file_range', 'splice', 'tee', 'sendfile',
  'fadvise64', 'readahead',
  'statx',
];

// Network syscalls (blocked by default, network is disabled anyway)
const NETWORK_SYSCALLS = [
  'socket', 'connect', 'accept', 'accept4',
  'sendto', 'recvfrom', 'sendmsg', 'recvmsg',
  'shutdown', 'bind', 'listen', 'getsockname', 'getpeername',
  'socketpair', 'setsockopt', 'getsockopt',
  'sendmmsg', 'recvmmsg',
];

// Language-specific additional syscalls
const LANGUAGE_SPECIFIC_SYSCALLS: Record<Language, string[]> = {
  python: [
    // Python needs these for imports and multiprocessing
    'shmget', 'shmat', 'shmdt', 'shmctl',
    'semget', 'semop', 'semctl', 'semtimedop',
    'msgget', 'msgsnd', 'msgrcv', 'msgctl',
  ],

  typescript: [
    // Bun/V8 specific
    'shmget', 'shmat', 'shmdt', 'shmctl',
  ],

  javascript: [
    // Node.js/V8 specific
    'shmget', 'shmat', 'shmdt', 'shmctl',
  ],

  go: [
    // Go runtime needs these
    'shmget', 'shmat', 'shmdt', 'shmctl',
    'mlock2',
  ],

  rust: [
    // Rust runtime (minimal additional needs)
    'shmget', 'shmat', 'shmdt', 'shmctl',
  ],

  bash: [
    // Bash needs process control
    'shmget', 'shmat', 'shmdt', 'shmctl',
  ],

  ruby: [
    // Ruby (not implemented yet, but type requires it)
    'shmget', 'shmat', 'shmdt', 'shmctl',
  ],
};

/**
 * Generate seccomp profile for a specific language
 */
export function getSeccompProfile(language: Language): SeccompProfile {
  const allowedSyscalls = [
    ...BASE_ALLOWED_SYSCALLS,
    ...LANGUAGE_SPECIFIC_SYSCALLS[language],
    // Network syscalls included but network is disabled at Docker level
    ...NETWORK_SYSCALLS,
  ];

  return {
    defaultAction: 'SCMP_ACT_ERRNO', // Block by default with EPERM
    architectures: [
      'SCMP_ARCH_X86_64',
      'SCMP_ARCH_X86',
      'SCMP_ARCH_AARCH64', // ARM64 for Apple Silicon
      'SCMP_ARCH_ARM',
    ],
    syscalls: [
      // Allow necessary syscalls
      {
        names: allowedSyscalls,
        action: 'SCMP_ACT_ALLOW',
      },
      // Explicitly block dangerous syscalls with KILL
      {
        names: BLOCKED_SYSCALLS,
        action: 'SCMP_ACT_KILL',
      },
    ],
  };
}

/**
 * Get seccomp profile as JSON string for Docker
 */
export function getSeccompProfileJson(language: Language): string {
  return JSON.stringify(getSeccompProfile(language));
}

/**
 * Security levels for different use cases
 */
export type SecurityLevel = 'strict' | 'standard' | 'permissive';

/**
 * Get resource limits based on security level
 */
export function getResourceLimits(level: SecurityLevel = 'standard'): {
  memory: string;
  cpus: string;
  pidsLimit: number;
  noNewPrivileges: boolean;
  readonlyRootfs: boolean;
  capDrop: string[];
  capAdd: string[];
} {
  switch (level) {
    case 'strict':
      return {
        memory: '256m',
        cpus: '0.5',
        pidsLimit: 50,
        noNewPrivileges: true,
        readonlyRootfs: true,
        capDrop: ['ALL'],
        capAdd: [],
      };

    case 'standard':
      return {
        memory: '512m',
        cpus: '1.0',
        pidsLimit: 100,
        noNewPrivileges: true,
        readonlyRootfs: false, // Need to write temp files
        capDrop: ['ALL'],
        capAdd: ['CHOWN', 'SETUID', 'SETGID'], // Minimal for package install
      };

    case 'permissive':
      return {
        memory: '1g',
        cpus: '2.0',
        pidsLimit: 200,
        noNewPrivileges: true,
        readonlyRootfs: false,
        capDrop: ['NET_RAW', 'SYS_ADMIN', 'SYS_PTRACE'],
        capAdd: [],
      };
  }
}

/**
 * Validate that seccomp is available on the system
 */
export async function isSeccompAvailable(): Promise<boolean> {
  try {
    const { execSync } = await import('child_process');
    const result = execSync('docker info --format "{{.SecurityOptions}}"', {
      encoding: 'utf-8',
    });
    return result.includes('seccomp');
  } catch {
    return false;
  }
}
