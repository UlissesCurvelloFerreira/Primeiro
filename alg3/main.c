#include <stdio.h>
#include <stdlib.h>
#include "avl-tree.h"

int main() {
    arvore *minha_arvore = cria_arvore();
    char operacao;
    int valor;

    printf("Operações disponíveis:\n");
    printf("i - Inserir\n");
    printf("b - Buscar\n");
    printf("r - Remover\n");
    printf("q - Sair\n");

    while (1) {
        printf("\nDigite a operação desejada (i/b/r/q): ");
        scanf(" %c", &operacao);

        if (operacao == 'q') {
            break; // Sair do loop
        }

        printf("Digite o valor: ");
        scanf("%d", &valor);

        switch (operacao) {
            case 'i':
                minha_arvore->raiz = insere_nodo(minha_arvore->raiz, valor);
                printf("Valor %d inserido na árvore.\n", valor);
                break;
            case 'b':
                if (busca(minha_arvore->raiz, valor)) {
                    printf("Valor %d encontrado na árvore.\n", valor);
                } else {
                    printf("Valor %d não encontrado na árvore.\n", valor);
                }
                break;
            case 'r':
                minha_arvore->raiz = remove_nodo(minha_arvore->raiz, valor);
                printf("Valor %d removido da árvore.\n", valor);
                break;
            default:
                printf("Operação inválida. Tente novamente.\n");
        }

        printf("Árvore AVL atual:\n");
        imprime_arvore(minha_arvore->raiz, 0);
    }

    // Liberar memória antes de sair do programa
    destruir_arvore(minha_arvore->raiz);
    free(minha_arvore);

    return 0;
}
