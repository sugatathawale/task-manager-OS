CC=gcc
CFLAGS=-Wall -Wextra -O2

all: taskd

taskd: server.c
	$(CC) $(CFLAGS) server.c -o taskd

run: taskd
	./taskd

clean:
	rm -f taskd
