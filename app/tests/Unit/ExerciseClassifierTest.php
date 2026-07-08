<?php

namespace Tests\Unit;

use App\Support\ExerciseClassifier;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class ExerciseClassifierTest extends TestCase
{
    private ExerciseClassifier $classifier;

    protected function setUp(): void
    {
        parent::setUp();
        $this->classifier = new ExerciseClassifier();
    }

    public static function cases(): array
    {
        return [
            // arquivo, músculo esperado, equipamento esperado
            ['104DBUprightRow', 'ombro', 'halter'],
            ['02CBSideBend', 'core', 'cabo'],
            ['141BBWristCurl', 'antebraco', 'barra'],
            ['437Barbellbenchpressflatoverhandwidegrip', 'peitoral', 'barra'],
            ['single_leg_pushup', 'peitoral', 'peso_corporal'],
            ['107DBLateralRaise', 'ombro', 'halter'],
            ['133BBReverseWristCurl', 'antebraco', 'barra'],
            ['Bodyweightsquatjump', 'pernas', 'peso_corporal'],
        ];
    }

    #[DataProvider('cases')]
    public function test_classifies_muscle_and_equipment(string $file, string $muscle, string $equipment): void
    {
        $result = $this->classifier->classify($file);

        $this->assertSame($muscle, $result['muscle_group'], "Músculo de {$file}");
        $this->assertSame($equipment, $result['equipment'], "Equipamento de {$file}");
    }

    public function test_detects_stretch_and_unilateral(): void
    {
        $stretch = $this->classifier->classify('101Stretch-Deltoid-01');
        $this->assertTrue($stretch['is_stretch']);
        $this->assertSame('ombro', $stretch['muscle_group']);

        $uni = $this->classifier->classify('SL_Burpee');
        $this->assertTrue($uni['is_unilateral']);
    }
}
