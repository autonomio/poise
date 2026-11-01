#define _GNU_SOURCE
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

struct receipt { int output; int proc; pthread_t leader; };

static void *remaining_thread(void *opaque) {
    struct receipt *receipt = opaque;
    /* pthread_exit may load its unwind library. Closing the shared fd table
       while it does so makes the fixture itself abort intermittently. */
    if (pthread_join(receipt->leader, NULL) != 0) _exit(4);
    char path[96], outer[64];
    snprintf(path, sizeof(path), "/proc/self/fd/%d/self", receipt->proc);
    ssize_t length = readlink(path, outer, sizeof(outer) - 1);
    if (length < 1) _exit(2);
    outer[length] = '\0';
    dprintf(receipt->output, "{\"kind\":\"leaf\",\"variant\":\"thread-leader-exited\",\"pid\":%ld,\"outer_pid\":%s}\n", (long)getpid(), outer);
    for (int fd = 0; fd < 1024; fd++) close(fd);
    sleep(60);
    return NULL;
}

int main(int argc, char **argv) {
    if (argc != 3) return 2;
    static struct receipt receipt;
    receipt.output = atoi(argv[1]);
    receipt.proc = atoi(argv[2]);
    receipt.leader = pthread_self();
    pthread_t thread;
    if (pthread_create(&thread, NULL, remaining_thread, &receipt) != 0) return 3;
    pthread_exit(NULL);
}
