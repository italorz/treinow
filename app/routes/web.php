<?php

use App\Http\Controllers\ExerciciosController;
use App\Http\Controllers\HojeController;
use App\Http\Controllers\PerfilController;
use App\Http\Controllers\SemanaController;
use Illuminate\Support\Facades\Route;

Route::get('/', [HojeController::class, 'index'])->name('hoje');
Route::post('/hoje/{item}/trocar', [HojeController::class, 'swap'])->name('hoje.swap');
Route::post('/hoje/{item}/concluir', [HojeController::class, 'toggleDone'])->name('hoje.done');

Route::get('/exercicios', [ExerciciosController::class, 'index'])->name('exercicios');
Route::get('/api/exercicios', [ExerciciosController::class, 'list'])->name('exercicios.list');
Route::get('/exercicios/{exercise}/alternativas', [ExerciciosController::class, 'alternatives'])->name('exercicios.alternatives');

Route::get('/semana', [SemanaController::class, 'index'])->name('semana');

Route::get('/eu', [PerfilController::class, 'edit'])->name('perfil');
Route::post('/eu', [PerfilController::class, 'update'])->name('perfil.update');
Route::post('/eu/gerar-treino', [PerfilController::class, 'generate'])->name('perfil.generate');
