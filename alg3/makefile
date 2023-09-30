CC = gcc
CFLAGS = -Wall -Wextra -std=c99
LIBS = -lm

all: avl

avl: avl-tree.o main.o
	$(CC) $(CFLAGS) -o avl avl-tree.o main.o $(LIBS)

avl-tree.o: avl-tree.c avl-tree.h
	$(CC) $(CFLAGS) -c avl-tree.c -o avl-tree.o

main.o: main.c avl-tree.h
	$(CC) $(CFLAGS) -c main.c -o main.o

clean:
	rm -f avl avl-tree.o main.o
