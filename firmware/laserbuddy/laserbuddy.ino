#include <Servo.h>

Servo panServo;
Servo tiltServo;

int panPin = 9;
int tiltPin = 10;
int laserPin = 7;

// limits so it doesnt hit the frame
// (if tilt hits something at the end make the number smaller, and change laser.py too)
int panMin = 10;
int panMax = 170;
int tiltMin = 0;
int tiltMax = 180;

// laser shuts off after 15 seconds of no commands
unsigned long laserTimeout = 15000;

float panAngle = 90;
float tiltAngle = 90;
unsigned long lastCommandTime = 0;
bool laserIsOn = false;

// using a char array not a String because Strings mess up the memory
// on the uno after a while and it just stops working
char input[48];
int inputLength = 0;

void laser(bool turnOn)
{
  laserIsOn = turnOn;
  if (turnOn)
  {
    digitalWrite(laserPin, HIGH);
  }
  else
  {
    digitalWrite(laserPin, LOW);
  }
}

void updateServos()
{
  // angle * 10 so we dont lose the decimal
  long panPulse = map((long)(panAngle * 10), 0, 1800, 500, 2400);
  long tiltPulse = map((long)(tiltAngle * 10), 0, 1800, 500, 2400);
  panServo.writeMicroseconds(panPulse);
  tiltServo.writeMicroseconds(tiltPulse);
}

void moveServos(float newPan, float newTilt, bool smooth)
{
  // keep it inside the limits
  if (newPan < panMin)
    newPan = panMin;
  if (newPan > panMax)
    newPan = panMax;
  if (newTilt < tiltMin)
    newTilt = tiltMin;
  if (newTilt > tiltMax)
    newTilt = tiltMax;

  if (smooth == false)
  {
    panAngle = newPan;
    tiltAngle = newTilt;
    updateServos();
    delay(350);
    return;
  }

  float panChange = newPan - panAngle;
  float tiltChange = newTilt - tiltAngle;
  float startPan = panAngle;
  float startTilt = tiltAngle;

  // figure out how many steps (about 1.5 degrees each)
  float biggest = fabs(panChange);
  if (fabs(tiltChange) > biggest)
  {
    biggest = fabs(tiltChange);
  }
  int steps = biggest / 1.5;
  if (steps < 1)
  {
    steps = 1;
  }

  for (int i = 1; i <= steps; i++)
  {
    float amount = (float)i / steps;
    amount = amount * amount * (3 - 2 * amount); // makes it speed up and slow down
    panAngle = startPan + panChange * amount;
    tiltAngle = startTilt + tiltChange * amount;
    updateServos();
    delay(12);
  }
  delay(150);
}

// gets the 2 numbers out of something like "P 90 60"
// (strtod works with decimals, atoi doesnt)
bool getNumbers(char *text, float &pan, float &tilt)
{
  char *space = strchr(text, ' ');
  if (space == NULL)
  {
    return false;
  }
  char *end1;
  char *end2;
  pan = strtod(space, &end1);
  if (end1 == space)
  {
    return false; // no number
  }
  tilt = strtod(end1, &end2);
  if (end2 == end1)
  {
    return false;
  }
  return true;
}

void printPosition()
{
  Serial.print("OK ");
  Serial.print(panAngle, 1);
  Serial.print(' ');
  Serial.println(tiltAngle, 1);
}

void doCommand(char *text)
{
  // skip spaces at the start
  while (*text == ' ')
  {
    text++;
  }
  if (*text == 0)
  {
    return; // empty line
  }

  char letter = toupper(text[0]);
  lastCommandTime = millis();

  if (letter == 'P' || letter == 'J')
  {
    float pan, tilt;
    if (getNumbers(text, pan, tilt))
    {
      if (letter == 'P')
      {
        moveServos(pan, tilt, true);
      }
      else
      {
        moveServos(pan, tilt, false);
      }
      printPosition();
    }
    else
    {
      Serial.println("ERR usage: P <pan> <tilt>");
    }
  }
  else if (letter == 'L')
  {
    if (strchr(text, '1') != NULL)
    {
      laser(true);
    }
    else
    {
      laser(false);
    }
    if (laserIsOn)
    {
      Serial.println("OK laser on");
    }
    else
    {
      Serial.println("OK laser off");
    }
  }
  else if (letter == 'C')
  {
    laser(false);
    moveServos(90, 90, true);
    Serial.println("OK centered");
  }
  else if (letter == '?')
  {
    printPosition();
  }
  else
  {
    Serial.println("ERR unknown command");
  }
}

void setup()
{
  Serial.begin(115200);
  pinMode(laserPin, OUTPUT);
  laser(false);
  panServo.attach(panPin, 500, 2400);
  tiltServo.attach(tiltPin, 500, 2400);
  updateServos();
  Serial.println("LaserBuddy ready");
}

void loop()
{
  while (Serial.available() > 0)
  {
    char c = Serial.read();
    if (c == '\n' || c == '\r')
    {
      input[inputLength] = 0;
      doCommand(input);
      inputLength = 0;
    }
    else if (inputLength < 47)
    {
      input[inputLength] = c;
      inputLength++;
    }
  }

  // turn off laser if nobody sent anything for a while
  if (laserIsOn && millis() - lastCommandTime > laserTimeout)
  {
    laser(false);
  }
}