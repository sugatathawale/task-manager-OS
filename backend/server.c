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
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
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
} ProcessInfo;

typedef struct {
  char *data;
  size_t len;
  size_t cap;
} StrBuf;

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

static void read_status_info(const char *pid, long *vmsize_kb, long *vmrss_kb, uid_t *uid_out) {
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
    } else if (strncmp(line, "Uid:", 4) == 0) {
      unsigned long uid_val = 0;
      sscanf(line + 4, "%lu", &uid_val);
      if (uid_out) *uid_out = (uid_t)uid_val;
    }
  }
  fclose(fp);
}

static bool read_stat(const char *pid, ProcessInfo *info, unsigned long *cpu_ticks, unsigned long *start_ticks) {
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
    info.vmsize_kb = 0;
    info.vmrss_kb = 0;
    info.user[0] = '\0';

    unsigned long cpu_ticks = 0;
    unsigned long start_ticks = 0;
    if (!read_stat(ent->d_name, &info, &cpu_ticks, &start_ticks)) continue;

    uid_t uid_val = 0;
    read_status_info(ent->d_name, &info.vmsize_kb, &info.vmrss_kb, &uid_val);
    username_from_uid(uid_val, info.user, sizeof(info.user));

    double seconds = uptime - ((double)start_ticks / (double)ticks_per_sec);
    if (seconds > 0) {
      double total_time = (double)cpu_ticks / (double)ticks_per_sec;
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
  FILE *fp = popen("ps -axo user=,pid=,comm=,state=,rss=,vsz=,pcpu=,pmem=", "r");
  if (!fp) return NULL;

  size_t cap = 256;
  size_t count = 0;
  ProcessInfo *list = (ProcessInfo *)malloc(sizeof(ProcessInfo) * cap);
  if (!list) {
    pclose(fp);
    return NULL;
  }

  char line[512];
  while (fgets(line, sizeof(line), fp)) {
    int pid = 0;
    char user[64] = {0};
    char comm[256] = {0};
    char state[32] = {0};
    long rss = 0;
    long vsz = 0;
    double pcpu = 0.0;
    double pmem = 0.0;

    int fields = sscanf(line, "%63s %d %255s %31s %ld %ld %lf %lf", user, &pid, comm, state, &rss, &vsz, &pcpu, &pmem);
    if (fields < 4 || pid <= 0) continue;

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

    list[count++] = info;
  }

  pclose(fp);
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

static char *build_process_json(size_t *out_len) {
  size_t count = 0;
  ProcessInfo *list = collect_processes(&count);
  if (!list) return NULL;

  qsort(list, count, sizeof(ProcessInfo), compare_pid);

  char current_user[64];
  current_user_name(current_user, sizeof(current_user));

  StrBuf sb;
  sb_init(&sb, 8192);
  sb_appendf(&sb, "{\"current_user\":\"");
  sb_append_escaped(&sb, current_user);
  sb_appendf(&sb, "\",\"count\":%zu,\"processes\":[", count);

  for (size_t i = 0; i < count; ++i) {
    ProcessInfo *p = &list[i];
    if (i > 0) sb_appendf(&sb, ",");
    sb_appendf(&sb, "{\"pid\":%d,\"name\":\"", p->pid);
    sb_append_escaped(&sb, p->name);
    sb_appendf(&sb, "\",\"user\":\"");
    sb_append_escaped(&sb, p->user);
    sb_appendf(
        &sb,
        "\",\"state\":\"%c\",\"vmsize_kb\":%ld,\"vmrss_kb\":%ld,\"cpu_percent\":%.2f,\"mem_percent\":%.2f}",
        p->state, p->vmsize_kb, p->vmrss_kb, p->cpu_percent, p->mem_percent);
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
      snprintf(err, sizeof(err), "{\"error\":\"kill failed\",\"errno\":%d,\"message\":\"%s\"}", errno, strerror(errno));
      send_response(client, "500 Internal Server Error", "application/json", err, strlen(err));
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

static void parse_request(const char *req, char *method, size_t mlen, char *path, size_t plen, const char **body) {
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
