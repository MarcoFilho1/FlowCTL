# Overlay spike (Fase 1b)

Prova descartável do transporte e da janela do overlay: um app Swift sem
Xcode (SwiftPM + Command Line Tools) com um `NSPanel` flutuante e um
`WKWebView`, recebendo snapshots por HTTP num socket Unix.

```
./build.sh                                    # swift build -c release + build/FlowCTLSpike.app
build/FlowCTLSpike.app/Contents/MacOS/FlowCTLSpike   # roda com log no terminal (ou: open build/FlowCTLSpike.app)
./send.sh [sample.json]                       # POST /snapshot pelo socket
./bench.sh [N]                                # N snapshots de 20 nós a ~20/s + estatísticas
```

Endpoints em `~/.flowctl/overlay.sock` (HTTP/1.1, um pedido por conexão):

| Rota | O que faz |
| --- | --- |
| `POST /snapshot` | corpo JSON (objeto) → `window.flowctl.push(snapshot)`; 400 se não for JSON |
| `GET /health` | 200 `ok` |
| `GET /stats` | latências medidas até agora (min/p50/p95/max) |
| `GET /debug/capture` | PNG do que o WebView pintou, em `$TMPDIR/flowctl-spike-capture.png` |

## O que funcionou

- **Janela**: `NSPanel` com `.nonactivatingPanel`, `level = .floating`,
  `[.canJoinAllSpaces, .fullScreenAuxiliary]`, 360×480 no canto superior
  direito, fundo `NSVisualEffectView` (`.hudWindow`). Confirmado pelo
  `CGWindowListCopyWindowInfo`: na tela, camada 3 (floating), alpha 1. Sem
  ícone no Dock (`LSUIElement` + `.accessory`).
- **WKWebView** com `loadFileURL(_:allowingReadAccessTo:)` carregando
  `Contents/Resources/web/index.html` do bundle; sem servidor.
- **Socket Unix**: servidor POSIX mínimo (sem dependências), apaga o socket
  velho ao iniciar, socket com permissão 0600.
- **Do mod real**: um mod de sonda com `$.http.fetch("http://overlay/snapshot",
  { method: "POST", socketPath, body })` no `session.start` de um `claude -p`
  (2.1.295) fez 5 POSTs, todos 200, ida e volta de 0–18 ms medida no mod, e
  o HTML atualizou. No mesmo teste, `$.fs.write` num caminho absoluto fora do
  cwd gravou sem prompt (em `-p`; falta confirmar em sessão interativa).
- **seq**: snapshot com `seq` menor que o último é ignorado pela página.
- **Segurança básica**: o corpo é parseado e re-serializado antes de virar
  JS, então nada do request é executado como script; não-JSON dá 400.

## Latência

Medida dentro do app, do último byte do request lido até: (a) o `push()`
terminar no JS, (b) o segundo `requestAnimationFrame` depois dele (o frame
que mostra a mudança).

| Cenário | received→eval | received→paint |
| --- | --- | --- |
| `bench.sh 200` (20 nós, ~20/s) | p50 0,54 · p95 0,69 · máx 1,82 ms | p50 12,3 · p95 18,0 · máx 43,6 ms |
| 5 POSTs seguidos do mod real | 0,2–12,5 ms | 33–42 ms |
| primeiro POST após abrir | 2,8 ms | 29,9 ms |

O POST em si leva ~0,2 ms no `curl`. Ponta a ponta fica bem abaixo dos
500 ms do MVP; o custo dominante é o frame (60 Hz ≈ 16 ms), não o transporte.

## O que não funcionou / não foi testado

- `screencapture -x` falhou ("could not create image from display"): o
  terminal não tem permissão de Gravação de Tela. A verificação visual foi
  feita com `WKWebView.takeSnapshot` (`/debug/capture`) e a posição da janela
  com `CGWindowList`.
- A captura do WebView sai transparente; em modo escuro o texto branco
  some se não compor sobre um fundo (o endpoint já compõe).
- Não testado: Space em tela cheia, vários monitores, arrastar/redimensionar
  com uso real, o POST do mod com o overlay fechado (pelo `curl` a recusa é
  imediata), sessão interativa (só `claude -p`).
- A lista não rola: com 20 nós passa da altura da janela.

## Riscos para a Fase 5

- **`drawsBackground` é KVC privado** (`webView.setValue(false, forKey:)`), o
  jeito usual de deixar o blur aparecer. Pode quebrar numa versão do macOS;
  alternativa é aceitar fundo opaco ou `underPageBackgroundColor`.
- **`~/.flowctl` criado por outro processo** fica com a permissão dele (aqui
  já existia, 0755, criado pelo recorder). O socket é 0600, mas a pasta deve
  ser criada 0700 por quem chegar primeiro.
- **Um app por vez no socket**: um segundo overlay apaga o socket do
  primeiro ao iniciar. A Fase 5 deve checar `/health` antes de apagar e sair
  se já houver um vivo.
- **Sem Xcode**: o build via SwiftPM + `codesign -s -` funciona para uso
  local; notarização e distribuição continuam o risco da Fase 6.
- **Leitura da ponte**: `evaluateJavaScript` com JSON grande (snapshot de
  50 nós com descrições) ainda não foi medido; se pesar, trocar por
  `callAsyncJavaScript` com argumento ou por `WKScriptMessage` invertido.
- O servidor é mínimo (só `Content-Length`, sem chunked, sem keep-alive). Basta
  para `curl` e `$.http.fetch`; não é um servidor HTTP geral.
