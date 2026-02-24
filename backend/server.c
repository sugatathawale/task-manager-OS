#include <arpa/inet.h>
#include <ctype.h>
#include <dirent.h>
#include <errno.h>
#include <locale.h>
#include <netinet/in.h>
#include <pwd.h>
#include <signal.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#ifdef __APPLE__
#include <sys/sysctl.h>
#endif
#include <unistd.h>

#define PORT 8080
#define REQ_BUFFER 8192

typedef struct {
  int pid;
  char name[256];
  char user[64];
  char state;
  long vmsize_kb;
  long vmrss_kb;
  double cpu_percent;
  double mem_percent;
  double cpu_time_sec;
  int threads;
} ProcessInfo;

typedef struct {
  int pid;
  int count;
} ThreadCount;

typedef struct {
  double cpu_user_percent;
  double cpu_system_percent;
  double cpu_idle_percent;
  long mem_total_kb;
  long mem_used_kb;
  long app_memory_kb;
  long wired_memory_kb;
  long compressed_memory_kb;
  long cached_files_kb;
  long swap_used_kb;
} SystemStats;

typedef struct {
  char *data;
  size_t len;
  size_t cap;
} StrBuf;

#ifndef __APPLE__
typedef struct {
  unsigned long long user;
  unsigned long long nice;
  unsigned long long system;
  unsigned long long idle;
  unsigned long long iowait;
  unsigned long long irq;
  unsigned long long softirq;
  unsigned long long steal;
  bool valid;
} CpuSnapshot;

static CpuSnapshot g_prev_cpu = {0};
#endif

static void sb_init(StrBuf *sb, size_t cap) {
  sb->data = (char *)malloc(cap);
  sb->len = 0;
  sb->cap = cap;
  if (sb->data) sb->data[0] = '\0';
}

static void sb_ensure(StrBuf *sb, size_t extra) {
  if (sb->len + extra + 1 <= sb->cap) return;
  size_t new_cap = sb->cap * 2 + extra + 1;
  char *next = (char *)realloc(sb->data, new_cap);
  if (!next) return;
  sb->data = next;
  sb->cap = new_cap;
}

static void sb_appendf(StrBuf *sb, const char *fmt, ...) {
  va_list args;
  va_start(args, fmt);
  char tmp[1024];
  int written = vsnprintf(tmp, sizeof(tmp), fmt, args);
  va_end(args);
  if (written <= 0) return;
  sb_ensure(sb, (size_t)written);
  memcpy(sb->data + sb->len, tmp, (size_t)written);
  sb->len += (size_t)written;
  sb->data[sb->len] = '\0';
}

static void sb_append_escaped(StrBuf *sb, const char *s) {
  for (const char *p = s; *p; ++p) {
    if (*p == '"' || *p == '\\') {
      sb_ensure(sb, 2);
      sb->data[sb->len++] = '\\';
      sb->data[sb->len++] = *p;
    } else if (*p == '\n') {
      sb_ensure(sb, 2);
      sb->data[sb->len++] = '\\';
      sb->data[sb->len++] = 'n';
    } else {
      sb_ensure(sb, 1);
      sb->data[sb->len++] = *p;
    }
  }
  sb->data[sb->len] = '\0';
}

static bool is_pid_dir(const char *name) {
  if (!name || !*name) return false;
  for (const char *p = name; *p; ++p) {
    if (!isdigit((unsigned char)*p)) return false;
  }
  return true;
}

static long parse_size_kb(const char *raw) {
  if (!raw || !*raw) return 0;

  char tmp[64];
  size_t j = 0;
  for (size_t i = 0; raw[i] && j < sizeof(tmp) - 1; ++i) {
    char c = raw[i];
    if (isdigit((unsigned char)c) || c == '.' || c == 'K' || c == 'k' || c == 'M' || c == 'm' ||
        c == 'G' || c == 'g' || c == 'T' || c == 't' || c == 'B' || c == 'b') {
      tmp[j++] = c;
    }
  }
  tmp[j] = '\0';
  if (tmp[0] == '\0') return 0;

  char *end = NULL;
  double value = strtod(tmp, &end);
  if (!end || end == tmp) return 0;

  char unit = '\0';
  while (*end) {
    if (isalpha((unsigned char)*end)) {
      unit = (char)tolower((unsigned char)*end);
      break;
    }
    end++;
  }

  double factor = 1.0;
  if (unit == 'b') factor = 1.0 / 1024.0;
  if (unit == 'k') factor = 1.0;
  if (unit == 'm') factor = 1024.0;
  if (unit == 'g') factor = 1024.0 * 1024.0;
  if (unit == 't') factor = 1024.0 * 1024.0 * 1024.0;

  if (value < 0) value = 0;
  return (long)(value * factor);
}

static double parse_cpu_time_seconds(const char *raw) {
  if (!raw || !*raw) return 0.0;

  int colons = 0;
  for (const char *p = raw; *p; ++p) {
    if (*p == ':') colons++;
  }

  int days = 0;
  int hours = 0;
  int minutes = 0;
  double seconds = 0.0;

  if (strchr(raw, '-')) {
    if (sscanf(raw, "%d-%d:%d:%lf", &days, &hours, &minutes, &seconds) == 4) {
      return (double)days * 86400.0 + (double)hours * 3600.0 + (double)minutes * 60.0 + seconds;
    }
  }

  if (colons == 2) {
    if (sscanf(raw, "%d:%d:%lf", &hours, &minutes, &seconds) == 3) {
      return (double)hours * 3600.0 + (double)minutes * 60.0 + seconds;
    }
  }

  if (colons == 1) {
    if (sscanf(raw, "%d:%lf", &minutes, &seconds) == 2) {
      return (double)minutes * 60.0 + seconds;
    }
  }

  return atof(raw);
}

static bool extract_size_before_word(const char *line, const char *word, long *out_kb) {
  if (!line || !word || !out_kb) return false;

  char copy[512];
  snprintf(copy, sizeof(copy), "%s", line);

  char prev[64] = {0};
  char *tok = strtok(copy, " \t\r\n");
  while (tok) {
    char cleaned[64] = {0};
    size_t j = 0;
    for (size_t i = 0; tok[i] && j < sizeof(cleaned) - 1; ++i) {
      if (isalnum((unsigned char)tok[i]) || tok[i] == '.') {
        cleaned[j++] = tok[i];
      }
    }
    cleaned[j] = '\0';

    if (cleaned[0]) {
      if (strcasecmp(cleaned, word) == 0 && prev[0]) {
        *out_kb = parse_size_kb(prev);
        return *out_kb > 0;
      }
      snprintf(prev, sizeof(prev), "%s", cleaned);
    }

    tok = strtok(NULL, " \t\r\n");
  }

  return false;
}

static unsigned long long parse_u64_digits(const char *raw) {
  if (!raw) return 0;
  char digits[64];
  size_t j = 0;
  for (size_t i = 0; raw[i] && j < sizeof(digits) - 1; ++i) {
    if (isdigit((unsigned char)raw[i])) {
      digits[j++] = raw[i];
    }
  }
  digits[j] = '\0';
  if (!digits[0]) return 0;
  return strtoull(digits, NULL, 10);
}

static void username_from_uid(uid_t uid, char *out, size_t out_len) {
  if (!out || out_len == 0) return;
  struct passwd *pw = getpwuid(uid);
  if (pw && pw->pw_name) {
    snprintf(out, out_len, "%s", pw->pw_name);
    return;
  }
  snprintf(out, out_len, "%u", (unsigned)uid);
}

static void current_user_name(char *out, size_t out_len) {
  if (!out || out_len == 0) return;
  const char *name = getlogin();
  if (!name || !*name) {
    struct passwd *pw = getpwuid(getuid());
    if (pw && pw->pw_name) name = pw->pw_name;
  }
  if (!name) name = "unknown";
  snprintf(out, out_len, "%s", name);
}

static long read_mem_total_kb(void) {
#ifdef __APPLE__
  int64_t memsize = 0;
  size_t len = sizeof(memsize);
  if (sysctlbyname("hw.memsize", &memsize, &len, NULL, 0) == 0 && memsize > 0) {
    return (long)(memsize / 1024);
  }
#endif

  FILE *fp = fopen("/proc/meminfo", "r");
  if (!fp) return 0;
  char line[256];
  long total = 0;
  while (fgets(line, sizeof(line), fp)) {
    if (strncmp(line, "MemTotal:", 9) == 0) {
      sscanf(line + 9, "%ld", &total);
      break;
    }
  }
  fclose(fp);
  return total;
}

static double read_uptime_seconds(void) {
  FILE *fp = fopen("/proc/uptime", "r");
  if (!fp) return 0.0;
  double up = 0.0;
  fscanf(fp, "%lf", &up);
  fclose(fp);
  return up;
}

static void read_status_info(const char *pid, long *vmsize_kb, long *vmrss_kb, uid_t *uid_out,
                             int *threads_out) {
  char path[256];
  snprintf(path, sizeof(path), "/proc/%s/status", pid);
  FILE *fp = fopen(path, "r");
  if (!fp) return;
  char line[256];
  while (fgets(line, sizeof(line), fp)) {
    if (strncmp(line, "VmSize:", 7) == 0) {
      sscanf(line + 7, "%ld", vmsize_kb);
    } else if (strncmp(line, "VmRSS:", 6) == 0) {
      sscanf(line + 6, "%ld", vmrss_kb);
    } else if (strncmp(line, "Threads:", 8) == 0) {
      int threads_val = 0;
      sscanf(line + 8, "%d", &threads_val);
      if (threads_out) *threads_out = threads_val;
    } else if (strncmp(line, "Uid:", 4) == 0) {
      unsigned long uid_val = 0;
      sscanf(line + 4, "%lu", &uid_val);
      if (uid_out) *uid_out = (uid_t)uid_val;
    }
  }
  fclose(fp);
}

static bool read_stat(const char *pid, ProcessInfo *info, unsigned long *cpu_ticks,
                      unsigned long *start_ticks) {
  char path[256];
  snprintf(path, sizeof(path), "/proc/%s/stat", pid);
  FILE *fp = fopen(path, "r");
  if (!fp) return false;
  char buf[1024];
  if (!fgets(buf, sizeof(buf), fp)) {
    fclose(fp);
    return false;
  }
  fclose(fp);

  char *lpar = strchr(buf, '(');
  char *rpar = strrchr(buf, ')');
  if (!lpar || !rpar || rpar < lpar) return false;

  size_t name_len = (size_t)(rpar - lpar - 1);
  if (name_len >= sizeof(info->name)) name_len = sizeof(info->name) - 1;
  memcpy(info->name, lpar + 1, name_len);
  info->name[name_len] = '\0';

  char *rest = rpar + 2;
  info->state = *rest;

  unsigned long utime = 0;
  unsigned long stime = 0;
  unsigned long starttime = 0;

  char *p = rest + 2;
  int field_index = 4;
  while (*p) {
    while (*p == ' ') p++;
    if (!*p) break;
    char *end = NULL;
    unsigned long val = strtoul(p, &end, 10);
    if (end == p) break;
    if (field_index == 14) utime = val;
    if (field_index == 15) stime = val;
    if (field_index == 22) {
      starttime = val;
      break;
    }
    p = end;
    field_index++;
  }

  if (cpu_ticks) *cpu_ticks = utime + stime;
  if (start_ticks) *start_ticks = starttime;
  return true;
}

static ThreadCount *collect_thread_counts(size_t *out_count) {
  if (out_count) *out_count = 0;
  FILE *fp = popen("ps -M -ax", "r");
  if (!fp) return NULL;

  size_t cap = 256;
  size_t count = 0;
  ThreadCount *list = (ThreadCount *)malloc(sizeof(ThreadCount) * cap);
  if (!list) {
    pclose(fp);
    return NULL;
  }

  char line[512];
  while (fgets(line, sizeof(line), fp)) {
    if (strncmp(line, "USER", 4) == 0) continue;

    int pid = 0;
    char user[64] = {0};
    char tt[32] = {0};
    double cpu = 0.0;
    char stat[16] = {0};
    char pri[16] = {0};
    char stime[32] = {0};
    char utime[32] = {0};
    char command[256] = {0};

    int fields = sscanf(line, "%63s %d %31s %lf %15s %15s %31s %31s %255[^\n]", user, &pid, tt,
                        &cpu, stat, pri, stime, utime, command);
    if (fields < 2) {
      fields = sscanf(line, "%d %31s %lf %15s %15s %31s %31s %255[^\n]", &pid, tt, &cpu, stat,
                      pri, stime, utime, command);
      if (fields < 1) continue;
    }

    if (pid <= 0) continue;

    bool found = false;
    for (size_t i = 0; i < count; ++i) {
      if (list[i].pid == pid) {
        list[i].count += 1;
        found = true;
        break;
      }
    }

    if (!found) {
      if (count >= cap) {
        cap *= 2;
        ThreadCount *next = (ThreadCount *)realloc(list, sizeof(ThreadCount) * cap);
        if (!next) break;
        list = next;
      }
      list[count].pid = pid;
      list[count].count = 1;
      count++;
    }
  }

  pclose(fp);
  if (out_count) *out_count = count;
  return list;
}

static int find_thread_count(ThreadCount *list, size_t count, int pid) {
  if (!list || pid <= 0) return 0;
  for (size_t i = 0; i < count; ++i) {
    if (list[i].pid == pid) return list[i].count;
  }
  return 0;
}

static ProcessInfo *collect_processes_proc(size_t *out_count) {
  DIR *dir = opendir("/proc");
  if (!dir) return NULL;

  long mem_total_kb = read_mem_total_kb();
  double uptime = read_uptime_seconds();
  long ticks_per_sec = sysconf(_SC_CLK_TCK);
  long cpu_count = sysconf(_SC_NPROCESSORS_ONLN);
  if (ticks_per_sec <= 0) ticks_per_sec = 100;
  if (cpu_count <= 0) cpu_count = 1;

  size_t cap = 256;
  size_t count = 0;
  ProcessInfo *list = (ProcessInfo *)malloc(sizeof(ProcessInfo) * cap);
  if (!list) {
    closedir(dir);
    return NULL;
  }

  struct dirent *ent;
  while ((ent = readdir(dir)) != NULL) {
    if (!is_pid_dir(ent->d_name)) continue;
    if (count >= cap) {
      cap *= 2;
      ProcessInfo *next = (ProcessInfo *)realloc(list, sizeof(ProcessInfo) * cap);
      if (!next) break;
      list = next;
    }

    ProcessInfo info;
    memset(&info, 0, sizeof(info));
    info.pid = atoi(ent->d_name);

    unsigned long cpu_ticks = 0;
    unsigned long start_ticks = 0;
    if (!read_stat(ent->d_name, &info, &cpu_ticks, &start_ticks)) continue;

    uid_t uid_val = 0;
    read_status_info(ent->d_name, &info.vmsize_kb, &info.vmrss_kb, &uid_val, &info.threads);
    username_from_uid(uid_val, info.user, sizeof(info.user));

    double seconds = uptime - ((double)start_ticks / (double)ticks_per_sec);
    double total_time = (double)cpu_ticks / (double)ticks_per_sec;
    info.cpu_time_sec = total_time;

    if (seconds > 0) {
      info.cpu_percent = (total_time / seconds) * 100.0 / (double)cpu_count;
    } else {
      info.cpu_percent = 0.0;
    }

    if (mem_total_kb > 0) {
      info.mem_percent = ((double)info.vmrss_kb * 100.0) / (double)mem_total_kb;
    } else {
      info.mem_percent = 0.0;
    }

    list[count++] = info;
  }

  closedir(dir);
  *out_count = count;
  return list;
}

static ProcessInfo *collect_processes_ps(size_t *out_count) {
  FILE *fp = popen("ps -axo user=,pid=,comm=,state=,rss=,vsz=,pcpu=,pmem=,time=", "r");
  if (!fp) return NULL;

  size_t cap = 256;
  size_t count = 0;
  size_t thread_count_len = 0;
  ThreadCount *thread_counts = collect_thread_counts(&thread_count_len);
  ProcessInfo *list = (ProcessInfo *)malloc(sizeof(ProcessInfo) * cap);
  if (!list) {
    if (thread_counts) free(thread_counts);
    pclose(fp);
    return NULL;
  }

  char line[640];
  while (fgets(line, sizeof(line), fp)) {
    int pid = 0;
    char user[64] = {0};
    char comm[256] = {0};
    char state[32] = {0};
    long rss = 0;
    long vsz = 0;
    double pcpu = 0.0;
    double pmem = 0.0;
    char cputime[64] = {0};

    int fields = sscanf(line, "%63s %d %255s %31s %ld %ld %lf %lf %63s", user, &pid, comm, state,
                        &rss, &vsz, &pcpu, &pmem, cputime);
    if (fields < 8 || pid <= 0) continue;

    if (count >= cap) {
      cap *= 2;
      ProcessInfo *next = (ProcessInfo *)realloc(list, sizeof(ProcessInfo) * cap);
      if (!next) break;
      list = next;
    }

    ProcessInfo info;
    memset(&info, 0, sizeof(info));
    info.pid = pid;
    snprintf(info.user, sizeof(info.user), "%s", user);
    snprintf(info.name, sizeof(info.name), "%s", comm);
    info.state = state[0] ? state[0] : ' ';
    info.vmrss_kb = rss;
    info.vmsize_kb = vsz;
    info.cpu_percent = pcpu;
    info.mem_percent = pmem;
    info.cpu_time_sec = parse_cpu_time_seconds(cputime);
    info.threads = thread_counts ? find_thread_count(thread_counts, thread_count_len, pid) : 0;

    list[count++] = info;
  }

  pclose(fp);
  if (thread_counts) free(thread_counts);
  *out_count = count;
  return list;
}

static ProcessInfo *collect_processes(size_t *out_count) {
  ProcessInfo *list = collect_processes_proc(out_count);
  if (list) return list;
  return collect_processes_ps(out_count);
}

static int compare_pid(const void *a, const void *b) {
  const ProcessInfo *pa = (const ProcessInfo *)a;
  const ProcessInfo *pb = (const ProcessInfo *)b;
  return (pa->pid - pb->pid);
}

static void init_system_stats(SystemStats *stats) {
  memset(stats, 0, sizeof(*stats));
  stats->mem_total_kb = read_mem_total_kb();
}

#ifdef __APPLE__
static void read_system_stats_apple(SystemStats *stats) {
  FILE *fp = popen("top -l 1 -n 0", "r");
  if (fp) {
    char line[512];
    while (fgets(line, sizeof(line), fp)) {
      if (strstr(line, "CPU usage:")) {
        double user = 0.0;
        double sys = 0.0;
        double idle = 0.0;
        if (sscanf(line, "CPU usage: %lf%% user, %lf%% sys, %lf%% idle", &user, &sys, &idle) == 3) {
          stats->cpu_user_percent = user;
          stats->cpu_system_percent = sys;
          stats->cpu_idle_percent = idle;
        }
      }

      if (strstr(line, "PhysMem:")) {
        long used = 0;
        long wired = 0;
        long compressed = 0;
        long unused = 0;

        extract_size_before_word(line, "used", &used);
        extract_size_before_word(line, "wired", &wired);
        extract_size_before_word(line, "compressor", &compressed);
        extract_size_before_word(line, "unused", &unused);

        if (used > 0) stats->mem_used_kb = used;
        if (wired > 0) stats->wired_memory_kb = wired;
        if (compressed > 0) stats->compressed_memory_kb = compressed;

        if (stats->mem_total_kb <= 0 && used > 0 && unused > 0) {
          stats->mem_total_kb = used + unused;
        }
      }
    }
    pclose(fp);
  }

  long page_size = 4096;
  unsigned long long file_backed_pages = 0;
  unsigned long long active_pages = 0;
  unsigned long long inactive_pages = 0;
  unsigned long long speculative_pages = 0;
  unsigned long long free_pages = 0;
  unsigned long long wired_pages = 0;
  unsigned long long compressed_pages = 0;

  fp = popen("vm_stat", "r");
  if (fp) {
    char line[512];
    while (fgets(line, sizeof(line), fp)) {
      char *page_size_ptr = strstr(line, "page size of ");
      if (page_size_ptr) {
        long bytes = 0;
        if (sscanf(page_size_ptr, "page size of %ld bytes", &bytes) == 1 && bytes > 0) {
          page_size = bytes;
        }
      }

      if (strncmp(line, "File-backed pages:", 18) == 0) {
        file_backed_pages = parse_u64_digits(line);
      } else if (strncmp(line, "Pages active:", 13) == 0) {
        active_pages = parse_u64_digits(line);
      } else if (strncmp(line, "Pages inactive:", 15) == 0) {
        inactive_pages = parse_u64_digits(line);
      } else if (strncmp(line, "Pages speculative:", 18) == 0) {
        speculative_pages = parse_u64_digits(line);
      } else if (strncmp(line, "Pages free:", 11) == 0) {
        free_pages = parse_u64_digits(line);
      } else if (strncmp(line, "Pages wired down:", 17) == 0) {
        wired_pages = parse_u64_digits(line);
      } else if (strncmp(line, "Pages occupied by compressor:", 29) == 0) {
        compressed_pages = parse_u64_digits(line);
      }
    }
    pclose(fp);
  }

  if (file_backed_pages > 0) {
    stats->cached_files_kb = (long)((file_backed_pages * (unsigned long long)page_size) / 1024ULL);
  }

  if (stats->wired_memory_kb <= 0 && wired_pages > 0) {
    stats->wired_memory_kb = (long)((wired_pages * (unsigned long long)page_size) / 1024ULL);
  }

  if (stats->compressed_memory_kb <= 0 && compressed_pages > 0) {
    stats->compressed_memory_kb =
        (long)((compressed_pages * (unsigned long long)page_size) / 1024ULL);
  }

  if (stats->mem_used_kb <= 0 && stats->mem_total_kb > 0) {
    unsigned long long used_pages = active_pages + inactive_pages + speculative_pages + wired_pages;
    if (used_pages > 0) {
      stats->mem_used_kb = (long)((used_pages * (unsigned long long)page_size) / 1024ULL);
    } else if (free_pages > 0) {
      long free_kb = (long)((free_pages * (unsigned long long)page_size) / 1024ULL);
      if (stats->mem_total_kb > free_kb) stats->mem_used_kb = stats->mem_total_kb - free_kb;
    }
  }

  fp = popen("sysctl -n vm.swapusage", "r");
  if (fp) {
    char line[256];
    if (fgets(line, sizeof(line), fp)) {
      char *used_ptr = strstr(line, "used = ");
      if (used_ptr) {
        char used_raw[64] = {0};
        if (sscanf(used_ptr + 7, "%63s", used_raw) == 1) {
          stats->swap_used_kb = parse_size_kb(used_raw);
        }
      }
    }
    pclose(fp);
  }

  if (stats->app_memory_kb <= 0 && stats->mem_used_kb > 0) {
    long app = stats->mem_used_kb - stats->wired_memory_kb - stats->compressed_memory_kb;
    stats->app_memory_kb = app > 0 ? app : 0;
  }
}
#else
static void read_system_stats_linux(SystemStats *stats) {
  FILE *fp = fopen("/proc/stat", "r");
  if (fp) {
    char line[512];
    if (fgets(line, sizeof(line), fp)) {
      unsigned long long user = 0;
      unsigned long long nice = 0;
      unsigned long long system = 0;
      unsigned long long idle = 0;
      unsigned long long iowait = 0;
      unsigned long long irq = 0;
      unsigned long long softirq = 0;
      unsigned long long steal = 0;

      int fields = sscanf(line, "cpu %llu %llu %llu %llu %llu %llu %llu %llu", &user, &nice,
                          &system, &idle, &iowait, &irq, &softirq, &steal);
      if (fields >= 4) {
        unsigned long long total = user + nice + system + idle + iowait + irq + softirq + steal;

        if (g_prev_cpu.valid) {
          unsigned long long prev_total = g_prev_cpu.user + g_prev_cpu.nice + g_prev_cpu.system +
                                          g_prev_cpu.idle + g_prev_cpu.iowait + g_prev_cpu.irq +
                                          g_prev_cpu.softirq + g_prev_cpu.steal;
          unsigned long long delta_total = total > prev_total ? total - prev_total : 0;

          if (delta_total > 0) {
            unsigned long long delta_user =
                (user + nice) > (g_prev_cpu.user + g_prev_cpu.nice)
                    ? (user + nice) - (g_prev_cpu.user + g_prev_cpu.nice)
                    : 0;
            unsigned long long delta_system =
                system > g_prev_cpu.system ? system - g_prev_cpu.system : 0;
            unsigned long long delta_idle =
                (idle + iowait) > (g_prev_cpu.idle + g_prev_cpu.iowait)
                    ? (idle + iowait) - (g_prev_cpu.idle + g_prev_cpu.iowait)
                    : 0;

            stats->cpu_user_percent = ((double)delta_user * 100.0) / (double)delta_total;
            stats->cpu_system_percent = ((double)delta_system * 100.0) / (double)delta_total;
            stats->cpu_idle_percent = ((double)delta_idle * 100.0) / (double)delta_total;
          }
        }

        g_prev_cpu.user = user;
        g_prev_cpu.nice = nice;
        g_prev_cpu.system = system;
        g_prev_cpu.idle = idle;
        g_prev_cpu.iowait = iowait;
        g_prev_cpu.irq = irq;
        g_prev_cpu.softirq = softirq;
        g_prev_cpu.steal = steal;
        g_prev_cpu.valid = true;
      }
    }
    fclose(fp);
  }

  long mem_total = 0;
  long mem_available = 0;
  long cached = 0;
  long sreclaimable = 0;
  long shmem = 0;
  long active = 0;
  long inactive = 0;
  long swap_total = 0;
  long swap_free = 0;

  fp = fopen("/proc/meminfo", "r");
  if (fp) {
    char line[256];
    while (fgets(line, sizeof(line), fp)) {
      if (strncmp(line, "MemTotal:", 9) == 0) {
        sscanf(line + 9, "%ld", &mem_total);
      } else if (strncmp(line, "MemAvailable:", 13) == 0) {
        sscanf(line + 13, "%ld", &mem_available);
      } else if (strncmp(line, "Cached:", 7) == 0) {
        sscanf(line + 7, "%ld", &cached);
      } else if (strncmp(line, "SReclaimable:", 13) == 0) {
        sscanf(line + 13, "%ld", &sreclaimable);
      } else if (strncmp(line, "Shmem:", 6) == 0) {
        sscanf(line + 6, "%ld", &shmem);
      } else if (strncmp(line, "Active:", 7) == 0) {
        sscanf(line + 7, "%ld", &active);
      } else if (strncmp(line, "Inactive:", 9) == 0) {
        sscanf(line + 9, "%ld", &inactive);
      } else if (strncmp(line, "SwapTotal:", 10) == 0) {
        sscanf(line + 10, "%ld", &swap_total);
      } else if (strncmp(line, "SwapFree:", 9) == 0) {
        sscanf(line + 9, "%ld", &swap_free);
      }
    }
    fclose(fp);
  }

  if (mem_total > 0) stats->mem_total_kb = mem_total;
  if (mem_total > 0 && mem_available > 0 && mem_total > mem_available) {
    stats->mem_used_kb = mem_total - mem_available;
  }

  long cached_files = cached + sreclaimable - shmem;
  stats->cached_files_kb = cached_files > 0 ? cached_files : 0;
  stats->app_memory_kb = active + inactive;
  stats->wired_memory_kb = 0;
  stats->compressed_memory_kb = 0;

  if (swap_total > swap_free && swap_total > 0) {
    stats->swap_used_kb = swap_total - swap_free;
  }
}
#endif

static void read_system_stats(SystemStats *stats) {
  init_system_stats(stats);
#ifdef __APPLE__
  read_system_stats_apple(stats);
#else
  read_system_stats_linux(stats);
#endif

  if (stats->mem_total_kb <= 0) stats->mem_total_kb = read_mem_total_kb();
  if (stats->cpu_user_percent < 0) stats->cpu_user_percent = 0;
  if (stats->cpu_system_percent < 0) stats->cpu_system_percent = 0;
  if (stats->cpu_idle_percent < 0) stats->cpu_idle_percent = 0;
}

static char *build_process_json(size_t *out_len) {
  size_t count = 0;
  ProcessInfo *list = collect_processes(&count);
  if (!list) return NULL;

  qsort(list, count, sizeof(ProcessInfo), compare_pid);

  SystemStats stats;
  read_system_stats(&stats);

  char current_user[64];
  current_user_name(current_user, sizeof(current_user));

  StrBuf sb;
  sb_init(&sb, 8192);
  sb_appendf(&sb, "{\"current_user\":\"");
  sb_append_escaped(&sb, current_user);
  sb_appendf(
      &sb,
      "\",\"count\":%zu,\"mem_total_kb\":%ld,\"cpu_user_percent\":%.2f,\"cpu_system_percent\":%.2f,\"cpu_idle_percent\":%.2f,\"mem_used_kb\":%ld,\"app_memory_kb\":%ld,\"wired_memory_kb\":%ld,\"compressed_memory_kb\":%ld,\"cached_files_kb\":%ld,\"swap_used_kb\":%ld,\"processes\":[",
      count, stats.mem_total_kb, stats.cpu_user_percent, stats.cpu_system_percent,
      stats.cpu_idle_percent, stats.mem_used_kb, stats.app_memory_kb, stats.wired_memory_kb,
      stats.compressed_memory_kb, stats.cached_files_kb, stats.swap_used_kb);

  for (size_t i = 0; i < count; ++i) {
    ProcessInfo *p = &list[i];
    if (i > 0) sb_appendf(&sb, ",");
    sb_appendf(&sb, "{\"pid\":%d,\"name\":\"", p->pid);
    sb_append_escaped(&sb, p->name);
    sb_appendf(&sb, "\",\"user\":\"");
    sb_append_escaped(&sb, p->user);
    sb_appendf(
        &sb,
        "\",\"state\":\"%c\",\"threads\":%d,\"cpu_time_sec\":%.2f,\"vmsize_kb\":%ld,\"vmrss_kb\":%ld,\"cpu_percent\":%.2f,\"mem_percent\":%.2f}",
        p->state, p->threads, p->cpu_time_sec, p->vmsize_kb, p->vmrss_kb, p->cpu_percent,
        p->mem_percent);
  }

  sb_appendf(&sb, "]}");
  free(list);

  if (out_len) *out_len = sb.len;
  return sb.data;
}

static int extract_int_field(const char *body, const char *key) {
  if (!body || !key) return -1;
  const char *p = strstr(body, key);
  if (!p) return -1;
  p = strchr(p, ':');
  if (!p) return -1;
  p++;
  while (*p && !isdigit((unsigned char)*p) && *p != '-') p++;
  if (!*p) return -1;
  return atoi(p);
}

static void send_response(int client, const char *status, const char *content_type,
                          const char *body, size_t body_len) {
  char header[512];
  int header_len = snprintf(header, sizeof(header),
                            "HTTP/1.1 %s\r\n"
                            "Content-Type: %s\r\n"
                            "Content-Length: %zu\r\n"
                            "Access-Control-Allow-Origin: *\r\n"
                            "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
                            "Access-Control-Allow-Headers: Content-Type\r\n"
                            "Connection: close\r\n\r\n",
                            status, content_type, body_len);
  send(client, header, header_len, 0);
  if (body && body_len > 0) {
    send(client, body, body_len, 0);
  }
}

static void handle_options(int client) {
  send_response(client, "204 No Content", "text/plain", "", 0);
}

static void handle_request(int client, const char *method, const char *path, const char *body) {
  if (strcmp(method, "OPTIONS") == 0) {
    handle_options(client);
    return;
  }

  if (strcmp(method, "GET") == 0 && strcmp(path, "/api/processes") == 0) {
    size_t len = 0;
    char *json = build_process_json(&len);
    if (!json) {
      const char *err = "{\"error\":\"Failed to read process list\"}";
      send_response(client, "500 Internal Server Error", "application/json", err, strlen(err));
      return;
    }
    send_response(client, "200 OK", "application/json", json, len);
    free(json);
    return;
  }

  if (strcmp(method, "POST") == 0 && strcmp(path, "/api/kill") == 0) {
    int pid = extract_int_field(body, "pid");
    if (pid <= 0) {
      const char *err = "{\"error\":\"Invalid PID\"}";
      send_response(client, "400 Bad Request", "application/json", err, strlen(err));
      return;
    }

    int rc = kill(pid, SIGTERM);
    if (rc != 0) {
      char err[256];
      const char *status = "500 Internal Server Error";
      if (errno == EPERM) status = "403 Forbidden";
      if (errno == ESRCH) status = "404 Not Found";
      snprintf(err, sizeof(err), "{\"error\":\"kill failed\",\"errno\":%d,\"message\":\"%s\"}",
               errno, strerror(errno));
      send_response(client, status, "application/json", err, strlen(err));
      return;
    }

    char ok[128];
    snprintf(ok, sizeof(ok), "{\"status\":\"terminated\",\"pid\":%d}", pid);
    send_response(client, "200 OK", "application/json", ok, strlen(ok));
    return;
  }

  const char *not_found = "{\"error\":\"Not found\"}";
  send_response(client, "404 Not Found", "application/json", not_found, strlen(not_found));
}

static void parse_request(const char *req, char *method, size_t mlen, char *path, size_t plen,
                          const char **body) {
  (void)mlen;
  (void)plen;
  method[0] = '\0';
  path[0] = '\0';
  *body = NULL;

  sscanf(req, "%7s %255s", method, path);
  const char *sep = strstr(req, "\r\n\r\n");
  if (sep) *body = sep + 4;
}

int main(void) {
  setlocale(LC_NUMERIC, "C");

  int server_fd = socket(AF_INET, SOCK_STREAM, 0);
  if (server_fd < 0) {
    perror("socket");
    return 1;
  }

  int opt = 1;
  setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

  struct sockaddr_in addr;
  memset(&addr, 0, sizeof(addr));
  addr.sin_family = AF_INET;
  addr.sin_addr.s_addr = INADDR_ANY;
  addr.sin_port = htons(PORT);

  if (bind(server_fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
    perror("bind");
    close(server_fd);
    return 1;
  }

  if (listen(server_fd, 16) < 0) {
    perror("listen");
    close(server_fd);
    return 1;
  }

  printf("Process Manager API running on http://localhost:%d\n", PORT);

  while (1) {
    int client = accept(server_fd, NULL, NULL);
    if (client < 0) continue;

    char req[REQ_BUFFER];
    ssize_t len = recv(client, req, sizeof(req) - 1, 0);
    if (len <= 0) {
      close(client);
      continue;
    }
    req[len] = '\0';

    char method[8];
    char path[256];
    const char *body = NULL;
    parse_request(req, method, sizeof(method), path, sizeof(path), &body);

    handle_request(client, method, path, body);
    close(client);
  }

  close(server_fd);
  return 0;
}
