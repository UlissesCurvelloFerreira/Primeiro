#ifndef AVL_TREE_H
#define AVL_TREE_H

typedef struct nodo {
    int valor;
    struct nodo *esq;
    struct nodo *dir;
    int alt;
} nodo;

typedef struct arvore{
    struct nodo *raiz;
} arvore;

/*
 * Essa função aloca memória para a estrutura da árvore e 
 * a inicializa com uma raiz nula.
 * Caso a alocação de memória falhe, a função retorna NULL.
 */
arvore *cria_arvore();

/*
 * Essa função aloca memória para um novo nó, inicializa 
 * seus campos e define a altura (alt) como 1.
 * Os campos "esq" e "dir" são inicializados como NULL.
 */
nodo *cria_nodo(int valor);

/* Retorna a altura do nó, caso contrário, retorna 0. */
int altura(nodo *no);

/* Retorna o maior valor entre dois inteiros. */
int maior(int a, int b);

/* 
 * Retorna o fator de balanceamento, que é a diferença entre
 * a altura da subárvore esquerda e a altura da subárvore direita.
 */
int fator_balanceamento(nodo *no);

/*
 * Realiza rotação à direita em subárvore enraizada na raiz para manter
 * balanceamento AVL. Novo nó à esquerda da raiz vira nova raiz,
 * raiz original vira filho direito da nova raiz. Atualiza alturas
 * para manter diferença de altura entre subárvores <= 1 após inserções
 * ou exclusões. Fundamental para árvore AVL. 
 */
void rotacao_dir(nodo *raiz);

/*
 * Realiza rotação à esquerda em subárvore enraizada na raiz p/ manter
 * balanceamento AVL. Novo nó à direita da raiz vira nova raiz,
 * raiz original vira filho esquerdo da nova raiz. Atualiza alturas
 * p/ manter diferença de altura entre subárvores <= 1 após inserções
 * ou exclusões. Fundamental p/ árvore AVL. 
 */
void rotacao_esq(nodo *raiz);

// Acho que n vale a pena inserir as funções rl lr, 
//pois gasto mais de duas linhas para a criar as funções


int insere_nodo(arvore *raiz, int valor);


//*******************************************************************************
int busca(nodo *no, int r);
nodo *procura_menor(nodo *atual);
nodo *remove_nodo(nodo *raiz, int r);
//*******************************************************************************


/*
 * Esta função percorre a árvore em pós-ordem (esquerda, direita, raiz)
 * e libera a memória de cada nó à medida que avança.
 */
void destruir_arvore(nodo *no);


// fazer novamente nos padroes que o professor quer
void imprime_arvore(nodo *no, int nivel);

#endif
