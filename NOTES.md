# Testing

## INIT ORDER

- order should fail if the unique id is same as another order,
  if there is a open unique id order -> it should fail, Compression Program: Error Number: 9002. Error Message: Custom program error: 0x232a.
  or if it is already closed then also it should fail, same error as the above
- making and taking amount should not be set to 0, Error Code: InvalidAmount. Error Number: 6012.
- expire should be in future or null, Error Code: InvalidExpiration. Error Number: 6014.
- same input and output mints, Error Code: SameMints. Error Number: 6016
- light init hard coded accounts validation, Error Code: InvalidNumberOfAccounts. Error Number: 6027. Error Code: InvalidAccount. Error Number: 6025
- Transaction Size - 1145, WITH ALT 931

## Cancel, Expire Order

- for not expired orders, maker can only cancel, if not: Error Code: Unauthorized. Error Number: 6001.
- size - 1060 WITH no ALT
- expire - 1055 no ALT

## Create ATA

- size - 1094 with one ALT

## Update

- Transaction Size with ALT - 725 (no SOL)

## Fill

- Transaction Size 1158,1190 (600 address from 3 ALT) (no SOL)
- 397 with 2 ALT, size - 1184
- 996, 900 address from 4 ALT && 753 (3 ALT), error - RangeError: encoding overruns Uint8Array
