# Código Circular — aplicação web

Aplicação local em HTML, CSS e JavaScript para:

- gerar um código circular a partir de um link ou texto;
- baixar o resultado em PNG;
- compartilhar o PNG pelo recurso nativo do celular;
- ler o código pela câmera;
- selecionar uma imagem da galeria e recuperar o conteúdo.

## Arquivos

- `index.html`: estrutura da página;
- `style.css`: layout responsivo;
- `app.js`: compactação, geração, exportação, câmera e decodificação.

## Como executar

A câmera exige `localhost` ou HTTPS. Dentro da pasta do projeto, use uma das opções:

### Com Node.js

```bash
npx serve .
```

Abra o endereço informado, normalmente `http://localhost:3000`.

### Com Python

```bash
py -m http.server 8000
```

ou:

```bash
python -m http.server 8000
```

Abra `http://localhost:8000`.

## Observações

- O leitor foi calibrado para os códigos criados por esta versão web.
- O código precisa estar centralizado, ocupar boa parte do enquadramento e ser fotografado o mais perpendicularmente possível.
- O formato usa 320 traços, totalizando 80 bytes de pacote: 12 bytes de cabeçalho e até 68 bytes de payload compactado.
- URLs muito longas podem exigir um encurtador.
- Não há envio de imagens ou links para um servidor externo.
