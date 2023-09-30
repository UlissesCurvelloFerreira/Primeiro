#include "avl-tree.h"
#include <stdio.h>
#include <stdlib.h>

/* Cria a árvore que apontara para a raiz da AVL. */
arvore *cria_arvore() 
{
    arvore *nova_arvore;

    if (!(nova_arvore = malloc(sizeof(arvore))))
        return 0;

    nova_arvore->raiz = NULL;
    return nova_arvore;
}

/* Cria um novo nodo que será inserido na árvore. */
nodo *cria_nodo(int valor) 
{
    nodo *novo_nodo;

    if (!(novo_nodo = malloc(sizeof(nodo))))
        return 0;

    novo_nodo->valor = valor;
    novo_nodo->esq = NULL;
    novo_nodo->dir = NULL;
    novo_nodo->alt = 1;
    return novo_nodo;
}

/* Retorna a altura do no. */
int altura(nodo *no) 
{
    if (no == NULL) // no == NULL
        return -1;
    return no->alt;
}

/* Retorna o maior entre a e b. */
int maior(int a, int b) 
{
    if (a > b)
        return a;
    return b;
}

/* Devolve o balanciamento da árvore ou 0 se no nulo. */
int fator_balanceamento(nodo *no) 
{
    if (no == NULL) // no == NULL
        return 0;
    return altura(no->esq) - altura(no->dir);
}

/* Realiza rotação à direita para balanceamento AVL. */
void rotacao_dir(nodo *raiz) 
{
    nodo *no;

    no = raiz->esq;
    raiz->esq = no->dir;
    no->dir = raiz;

    /* Atualiza as alturas. */ //criar uma função atualiza altura???
    raiz->alt = 1 + maior(altura(raiz->esq), altura(raiz->dir));
    no->alt = 1+ maior(altura(no->esq), altura(raiz->alt));
   
    raiz = no;
}

/* Realiza rotação à esquerda para balanceamento AVL. */
void rotacao_esq(nodo *raiz) 
{
    nodo *no;

    no = raiz->dir;
    raiz->dir = no->esq;
    no->esq = raiz;

    /* Atualiza as alturas. */ //criar uma função atualiza altura???
    raiz->alt = 1 + maior(altura(raiz->esq), altura(raiz->dir));
    no->alt = 1+ maior(altura(no->dir), altura(raiz->alt));

    raiz = no;

}

/* Retorna 1 para verdadeiro ou 0 para falso. */
int insere_nodo(arvore *raiz, int valor)
{
    // 1º caso: Inserção inicial
    if (raiz == NULL) // da para simplificar.
    {
        raiz = cria_nodo(valor);
        return 1;
    }
    //

}

















/* Destrói árvore AVL. */
void destruir_arvore(nodo *no) 
{
    if (no != NULL) // no != NULL
    {
        destruir_arvore(no->esq);
        destruir_arvore(no->dir);
        free(no);
    }
}






//*******************************************************************************
// fazer novamente
void imprime_arvore(nodo *no, int nivel) {
    if (no != NULL) {
        imprime_arvore(no->dir, nivel + 1);

        for (int i = 0; i < nivel; i++) {
            printf("    ");
        }

        printf("%d\n", no->valor);

        imprime_arvore(no->esq, nivel + 1);
    }
}


/**/
int busca(nodo *no, int r) 
{
    if (no) // no == NULL
        return 0;
    if (r == no->valor) 
        return 1;
    if (r < no->valor) 
        return busca(no->esq, r);
    else 
        return busca(no->dir, r);
}

/* */
nodo *procura_menor(nodo *atual) 
{
    if (atual->esq == NULL) // altura->esq == NULL
        return atual;
    return procura_menor(atual->esq);
}

//*******************************************************************************
