# SGH — Sistema de Gerenciamento Hidráulico

Sistema industrial e residencial completo para **monitoramento de vazão de água em tempo real**, cálculo de consumo acumulado, estimativa financeira de custos e **detecção inteligente de vazamentos**.

Projetado para operar **100% OFFLINE**, com comunicação direta via cabo USB com microcontrolador **ESP32**, persistência em banco de dados **SQLite local**, interface web responsiva em **HTML5/CSS3/JavaScript puro** e gráficos em tempo real utilizando **Chart.js embutido localmente (sem CDN)**.

---

## 1. Arquitetura do Sistema

```
[ Sensor de Vazão ] (YF-S201 / TF-S201)
        │ Pulsos por Efeito Hall (5V com Divisor Resistivo para 3.3V)
        ▼
   [ ESP32 ] (GPIO 2 - Interrupção de Borda de Subida)
        │ Cabo USB (Comunicação Serial a 115200 baud)
        ▼
[ Backend Node.js / Express ]
   ├── SerialPort Service (ReadlineParser, Auto-Reconect, Filtro de Ruído)
   ├── SQLite Engine (Armazenamento permanente, histórico e configurações)
   ├── Motor de Detecção de Vazamentos (Ruptura, Fluxo Contínuo, Consumo Noturno)
   ├── Processador Financeiro (Tarifação R$/m³ ou R$/L)
   └── Simulador Hidráulico (Testes sem hardware com múltiplos cenários)
        │ HTTP / Cookies de Sessão Segura (scrypt + HMAC)
        ▼
[ Frontend Web Local (http://localhost:3000) ]
   ├── login.html (Autenticação com proteção contra força bruta)
   └── dashboard.html (Métricas em tempo real, Gráfico Chart.js local, Histórico e Alertas)
```

---

## 2. Esquema Elétrico e Ligação do Sensor ao ESP32

O sensor de vazão (YF-S201 / TF-S201) opera tipicamente com alimentação de 5V. Como os pinos GPIO do ESP32 toleram no máximo 3.3V, é **imprescindível** utilizar um divisor de tensão resistivo no fio de sinal.

### Pinout de Conexão:

| Sensor YF-S201 / TF-S201 | Pino no ESP32 DevKit | Função / Observação |
|---|---|---|
| **Fio Vermelho (VCC)** | **VIN** ou **5V** | Alimentação do sensor (5V da USB) |
| **Fio Preto (GND)** | **GND** | Referência comum de terra |
| **Fio Amarelo (Sinal de Pulso)** | **GPIO 2** (via divisor) | Pulsos de onda quadrada por efeito Hall |

### Circuito do Divisor Resistivo (5V → 3.3V):
```
Sinal do Sensor (5V) ────[ R1: 1kΩ ou 10kΩ ]────┬────> GPIO 2 do ESP32
                                                │
                                       [ R2: 2kΩ ou 20kΩ ]
                                                │
                                               GND
```
*Tensão resultante no pino do ESP32:* `Vout = 5V × (2k / (1k + 2k)) = 3.33V` (Seguro e estável).

### Cuidados Importantes com o GPIO 2 (Strapping Pin):
- O **GPIO 2** do ESP32 é um pino de strapping (usado no processo de boot para definir se a placa entra no modo de gravação ou execução normal) e também é conectado ao LED interno em muitas placas DevKit.
- Manter o resistor `R2` conectado ao GND assegura que durante a reinicialização o pino inicie em nível baixo, garantindo o boot perfeito da placa.
- Caso a sua placa apresente dificuldades para gravar firmware enquanto o sensor estiver conectado, basta desconectar momentaneamente o pino 2 durante o upload ou utilizar como alternativa o **GPIO 4**, alterando a constante `SENSOR_PIN` no firmware.

---

## 3. Guia de Instalação e Execução Passo a Passo

### 1. Instalar o Node.js
Baixe e instale o **Node.js LTS** (versão 18, 20 ou 22) em seu sistema operacional:
- [https://nodejs.org/](https://nodejs.org/)

### 2. Instalar a Arduino IDE
Baixe a **Arduino IDE 2.x**:
- [https://www.arduino.cc/en/software](https://www.arduino.cc/en/software)
- Instale o pacote de placas ESP32:
  1. Vá em *Arquivo > Preferências*.
  2. Em *URLs adicionais para Gerenciadores de Placas*, adicione:
     `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
  3. Vá em *Ferramentas > Placa > Gerenciador de Placas*, pesquise por `esp32` da Espressif e clique em Instalar.

### 3. Conectar o sensor ao ESP32
Monte o circuito conforme o esquema do divisor de tensão apresentado acima e conecte a placa ESP32 a uma porta USB do seu computador.

### 4. Identificar a porta serial
- **Windows:** Abra o *Gerenciador de Dispositivos > Portas (COM e LPT)*. Exemplo: `COM3`, `COM4`.
- **Linux:** Execute no terminal: `ls /dev/ttyUSB* /dev/ttyACM*`. (Adicione seu usuário ao grupo dialout: `sudo usermod -a -G dialout $USER`).
- **macOS:** Execute no terminal: `ls /dev/cu.usbserial*`.

### 5. Compilar e gravar o firmware
1. Abra o arquivo `firmware/sgh_esp32.ino` na Arduino IDE.
2. Selecione a placa: *Ferramentas > Placa > ESP32 Arduino > ESP32 Dev Module*.
3. Selecione a Porta Serial identificada.
4. Clique no botão **Carregar (Upload)**.
5. Abra o Monitor Serial a 115200 baud para verificar o envio da linha JSON a cada segundo:
   `{"vazao_lmin":0.00,"litros_totais":0.00,"status":"normal"}`.
6. **Feche o Monitor Serial da Arduino IDE** antes de iniciar o backend Node.js para liberar a porta USB.

### 6. Configurar o fator de calibração
- Para o sensor **YF-S201 (1/2")**: `Fator = 7.5` (~450 pulsos por litro).
- Para o sensor **TF-S201**: `Fator = 5.5` a `7.5` (calibrado experimentalmente com um recipiente graduado de 1 litro).
- O fator pode ser ajustado diretamente pela interface web na tela de Configurações sem precisar regravar o microcontrolador!

### 7. Instalar as dependências do Node.js
Na pasta raiz do projeto, instale as dependências:
```bash
npm install express serialport @serialport/parser-readline cors cookie-parser sql.js
```

### 8. Disponibilizar o Chart.js localmente
O arquivo `chart.umd.js` já está embutido em `frontend/vendor/chart.umd.js`. Não há nenhuma requisição externa a CDNs durante a execução.

### 9. Configurar o arquivo `.env`
Copie o arquivo de exemplo `.env.example` para `.env`:
```bash
cp .env.example .env
```
Edite as variáveis conforme sua necessidade (porta serial, senhas, etc.).

### 10. Criar o usuário administrador
O usuário administrador inicial é gerado automaticamente na primeira execução do backend com credenciais seguras:
- **Usuário padrão:** `admin`
- **Senha padrão:** `admin123`
*(As senhas são protegidas com salt criptográfico de 16 bytes e hash scrypt de 64 bytes)*.

### 11. Inicializar o banco SQLite
O banco de dados SQLite (`data/sgh.sqlite3`) é criado e estruturado automaticamente pelo backend, contendo tabelas indexadas para leituras, usuários, alertas e configurações.

### 12. Executar o servidor
Inicie a aplicação com o comando:
```bash
npm run dev
```
Para ambiente de produção:
```bash
npm start
```

### 13. Acessar o sistema pelo navegador
Abra seu navegador em:
**`http://localhost:3000/login.html`** (ou `http://localhost:3000`)
Insira as credenciais (`admin` / `admin123`) para acessar o painel de monitoramento.

### 14. Conexão direta com Hardware Real (Web Serial & Wi-Fi)
O SGH conecta-se diretamente aos microcontroladores físicos:
- **Cabo USB (Web Serial):** Conecte o Arduino ou ESP32 via USB e clique em "Conectar via Cabo USB" na aba Dispositivos do navegador.
- **Wi-Fi / Rede Local:** Configure o ESP32 para enviar leituras periódicas via requisições HTTP POST para `/api/telemetria/leitura`.

### 15. Resolver problemas de conexão serial
- **Erro de Porta Bloqueada (Access Denied / Busy):** Certifique-se de fechar o Monitor Serial da Arduino IDE ou qualquer outro software que esteja utilizando a mesma porta serial.
- **Porta não detectada:** Verifique se o cabo USB é de dados (alguns cabos fornecem apenas alimentação de carga). No Linux, confirme as permissões do usuário (`sudo chmod 666 /dev/ttyUSB0`).
- Utilize o botão **"Detectar Portas"** na janela de Configurações do SGH para escanear automaticamente as conexões USB ativas.

### 16. Fazer backup dos dados
- Clique no ícone de disquete no cabeçalho do Dashboard ou faça uma requisição para `POST /api/backup`.
- Uma cópia timestamped será gravada automaticamente no diretório local `data/backups/sgh_backup_YYYY-MM-DD.sqlite3`.

### 17. Reiniciar o sistema após desligar o computador
Como a aplicação opera com SQLite em disco e portas seriais persistidas:
1. Conecte o ESP32 na porta USB.
2. Inicie o servidor: `npm run dev` ou configure para iniciar como serviço local do sistema.
3. Abra `http://localhost:3000`. Todos os registros de consumo acumulado, histórico e configurações permanecem intactos.

---

## 4. Endpoints da API REST

| Método | Endpoint | Protegido | Descrição |
|---|---|---|---|
| `GET` | `/api/saude` | Não | Estado geral do backend e consumo de memória |
| `POST` | `/api/login` | Não | Autenticação com rate limiting (bloqueio por força bruta) |
| `POST` | `/api/logout` | Sim | Encerramento seguro da sessão |
| `GET` | `/api/status` | Sim | Vazão em tempo real, volume em L/m³, custo em R$, estado do sensor |
| `GET` | `/api/historico` | Sim | Consultas paginadas de medições com filtro de período |
| `GET` | `/api/alertas` | Sim | Listagem de alertas ativos e histórico de incidentes |
| `POST` | `/api/alertas/:id/reconhecer` | Sim | Reconhecer ou resolver alerta |
| `GET` | `/api/configuracoes` | Sim | Parâmetros de calibração, tarifa e limites |
| `PUT` | `/api/configuracoes` | Sim | Atualização de tarifa, calibração e portas |
| `GET` | `/api/serial/portas` | Sim | Detecção de portas USB físicas no computador |
| `POST` | `/api/serial/conectar` | Sim | Conexão manual a uma porta serial específica |
| `POST` | `/api/simulacao/toggle` | Sim | Alternância entre hardware físico e simulador |
| `POST` | `/api/simulacao/cenario` | Sim | Alteração de perfil de simulação |
| `POST` | `/api/backup` | Sim | Criação de cópia do arquivo do banco SQLite |

---

## 5. Testes Automatizados

O sistema conta com suíte de testes unitários para cálculo de vazão, volume acumulado, tarifas, validação JSON, regras de vazamento e segurança.

Para executar os testes:
```bash
npm test
```
Resultados esperados: 12/12 testes aprovados.

---

## 6. Licença e Autoria
Desenvolvido para o **SGH — Sistema de Gerenciamento Hidráulico**. Arquitetura limpa, segura e 100% offline.
