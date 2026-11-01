#include <stdlib.h>

/* An ordinary valid ASan/LSan executable must keep its exit semantics. */
int main(void) {
    char *memory = malloc(32);
    if (memory == NULL) return 2;
    memory[31] = 23;
    int result = memory[31];
    free(memory);
    return result == 23 ? 0 : 3;
}
