: IF
[ return1
; immediate

: THEN
] postpone ifthenjump
literal eval-tokens dict dict-lookup swapdrop swapdrop dict-entry-data jump
; immediate

(
: '
*tokenizer* next-token not IF eos error return 0 THEN
dict dict-lookup dup not IF drop not-found error return0 THEN
return1
;
)
