/**
 * ==============================================================================
 * SGH — Sistema de Gerenciamento Hidráulico
 * Firmware Oficial para ESP32 (Arduino IDE C/C++)
 * ==============================================================================
 * 
 * Hardware:
 *   - Microcontrolador: ESP32 DevKit v1 (30 ou 38 pinos)
 *   - Sensor de Vazão: YF-S201 (1/2") ou TF-S201 (Efeito Hall)
 * 
 * ESQUEMA DE LIGAÇÃO E PINOUT:
 *   +--------------------+-------------------------+-------------------------------+
 *   | Sensor YF-S201     | ESP32 DevKit Pin        | Observações Elétricas         |
 *   +--------------------+-------------------------+-------------------------------+
 *   | Vermelho (VCC)     | VIN / 5V                | Sensor opera idealmente em 5V |
 *   | Preto (GND)        | GND                     | Terra comum                   |
 *   | Amarelo (Sinal)    | GPIO 2 (com divisor)    | Divisor de tensão obrigatório |
 *   +--------------------+-------------------------+-------------------------------+
 * 
 * CUIDADOS COM O GPIO 2 (STRAPPING PIN & NÍVEL DE TENSÃO):
 *   1. COMPATIBILIDADE DE TENSÃO: O sensor alimentado em 5V envia pulsos de 5V.
 *      O GPIO do ESP32 suporta no máximo 3.3V. É OBRIGATÓRIO usar um divisor resistivo:
 *        Sinal Sensor (5V) ---> [ Resistor 1kΩ ou 10kΩ ] ---> GPIO 2
 *                                                        |
 *                                               [ Resistor 2kΩ ou 20kΩ ]
 *                                                        |
 *                                                       GND
 *      Isso rebaixa 5V para ~3.3V protegendo a porta do ESP32.
 * 
 *   2. STRAPPING PIN: O GPIO 2 é um pino de strapping do ESP32. Se for mantido em nível
 *      ALTO durante o boot, pode interferir no modo de gravação (flashing). O divisor
 *      com referência ao GND garante que o pino inicie em nível baixo na inicialização.
 *      (O LED onboard da maioria das placas DevKit também pisca no GPIO 2).
 * 
 * FÓRMULA DE VAZÃO:
 *   Q (L/min) = (Frequência de pulsos [Hz] * 60) / Fator de Calibração
 *   - YF-S201 padrão: Fator = 7.5 (aproximadamente 450 pulsos por litro)
 *   - TF-S201 padrão: Fator = 5.5 a 7.5 (depende da calibragem experimental)
 * 
 * FORMATO SERIAL ENVIADO (1 linha JSON por segundo a 115200 baud):
 *   {"vazao_lmin":3.46,"litros_totais":10.5,"status":"normal"}
 * ==============================================================================
 */

#include <Arduino.h>

// Definição de Pinos
const uint8_t SENSOR_PIN = 2; // GPIO 2 com interrupção externa

// Parâmetros de Calibração (ajustáveis conforme o modelo de sensor)
// YF-S201: tipicamente 7.5; TF-S201: tipicamente 5.5
const float FATOR_CALIBRACAO = 7.5; 

// Variáveis de Contagem de Pulsos (compartilhadas com a ISR)
volatile uint32_t contadorPulsos = 0;
portMUX_TYPE spinlockPulsos = portMUX_INITIALIZER_UNLOCKED;

// Variáveis de Tempo e Acumulação de Volume
unsigned long tempoAnteriorMs = 0;
float volumeAcumuladoLitros = 0.0;

// ISR (Interrupt Service Routine) executada a cada pulso do sensor
void IRAM_ATTR tratarPulsoVazao() {
  portENTER_CRITICAL_ISR(&spinlockPulsos);
  contadorPulsos++;
  portEXIT_CRITICAL_ISR(&spinlockPulsos);
}

void setup() {
  // Inicialização da porta serial com baud rate estrito de 115200 bps
  Serial.begin(115200);
  
  // Pequena pausa para estabilização do hardware e da interface serial
  delay(100);

  // Configuração do pino do sensor como entrada com resistor pull-down interno
  pinMode(SENSOR_PIN, INPUT_PULLDOWN);

  // Anexa interrupção na borda de subida (RISING) dos pulsos do rotor magnético
  attachInterrupt(digitalPinToInterrupt(SENSOR_PIN), tratarPulsoVazao, RISING);

  tempoAnteriorMs = millis();
}

void loop() {
  unsigned long tempoAtualMs = millis();
  unsigned long deltaTempoMs = tempoAtualMs - tempoAnteriorMs;

  // Processa a leitura exatamente a cada 1000 milissegundos (1 segundo)
  if (deltaTempoMs >= 1000) {
    uint32_t pulsosNoIntervalo = 0;

    // Seção crítica para leitura e reset atômico do contador de pulsos
    portENTER_CRITICAL(&spinlockPulsos);
    pulsosNoIntervalo = contadorPulsos;
    contadorPulsos = 0;
    portEXIT_CRITICAL(&spinlockPulsos);

    tempoAnteriorMs = tempoAtualMs;

    // Cálculo exato da frequência em Hertz considerando o delta de tempo real
    float deltaSegundos = (float)deltaTempoMs / 1000.0;
    float frequenciaHz = (float)pulsosNoIntervalo / deltaSegundos;

    // Cálculo da vazão instantânea em Litros por Minuto:
    // Q (L/min) = (Frequência [Hz] * 60) / Fator de Calibração
    float vazaoLmin = 0.0;
    if (frequenciaHz > 0.0) {
      vazaoLmin = (frequenciaHz * 60.0) / FATOR_CALIBRACAO;
    }

    // Filtro contra ruído residual mínimo (ex: flutuação de 1 pulso espúrio)
    if (pulsosNoIntervalo <= 1 && vazaoLmin < 0.15) {
      vazaoLmin = 0.0;
    }

    // Cálculo do volume incremental em litros no intervalo atual:
    // Litros = (Vazão L/min / 60) * deltaSegundos
    float litrosIncrementais = (vazaoLmin / 60.0) * deltaSegundos;
    volumeAcumuladoLitros += litrosIncrementais;

    // Determinação do status do fluxo
    const char* statusStr = "normal";
    if (vazaoLmin > 30.0) {
      statusStr = "alerta_fluxo_alto";
    } else if (vazaoLmin == 0.0) {
      statusStr = "normal";
    }

    // Envio estrito da linha JSON sem caracteres estranhos ou mensagens extras
    // Exemplo: {"vazao_lmin":3.46,"litros_totais":10.50,"status":"normal"}
    Serial.print("{\"vazao_lmin\":");
    Serial.print(vazaoLmin, 2);
    Serial.print(",\"litros_totais\":");
    Serial.print(volumeAcumuladoLitros, 2);
    Serial.print(",\"status\":\"");
    Serial.print(statusStr);
    Serial.println("\"}");
  }
}
